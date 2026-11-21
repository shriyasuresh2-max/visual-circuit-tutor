import { termKey } from './electricalGraph.js';
import { displayZero } from './electricalDisplay.js';
import { resistorGeometry } from './resistorGeometry.js';

const EPSILON = 1e-6;
const pointKey = ({ x, y }) => `${x},${y}`;
const finitePoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pointOnRun(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const along = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length;
  return along >= -EPSILON && along <= length + EPSILON &&
    Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) <= EPSILON * length;
}

function physicalNet(terminals, wires, anchor, junctions) {
  const vertices = new Map();
  function vertex(point) {
    const key = pointKey(point);
    if (!vertices.has(key)) vertices.set(key, { point, edges: [], injection: 0 });
    return vertices.get(key);
  }
  for (const { point, injection } of terminals.values()) vertex(point).injection += injection;
  const points = new Map([...vertices].map(([key, { point }]) => [key, point]));
  for (const p of junctions.filter(finitePoint)) points.set(pointKey(p), p);
  for (const wire of wires) {
    if (wire.confidence < 0.6 || wire.points?.length < 2 || !wire.points?.every(finitePoint)) return null;
    for (const [id, at] of [[wire.from, wire.points[0]], [wire.to, wire.points.at(-1)]]) {
      const expected = id === `NODE:${anchor.id}` ? anchor : terminals.get(id)?.point;
      if (!finitePoint(expected) || distance(at, expected) > EPSILON) return null;
    }
    for (const p of wire.points) points.set(pointKey(p), p);
  }
  const edges = new Set();
  for (const { points: path } of wires) {
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      if (distance(a, b) <= EPSILON) continue;
      const split = [...points.values()].filter((p) => pointOnRun(p, a, b))
        .sort((p, q) => distance(p, a) - distance(q, a));
      for (let j = 1; j < split.length; j += 1) {
        const from = pointKey(split[j - 1]);
        const to = pointKey(split[j]);
        const id = [from, to].sort().join('|');
        if (edges.has(id)) continue;
        edges.add(id);
        vertex(split[j - 1]).edges.push(to);
        vertex(split[j]).edges.push(from);
      }
    }
  }
  return vertices;
}

// A cut in a conductor tree has a unique signed current: sum the terminal
// injections on one side. Edges on conductor cycles have no unique current.
function directedCuts(vertices, tolerance) {
  const first = vertices.keys().next().value;
  const visited = new Map();
  const stack = [];
  const cuts = [];
  function visit(id) {
    const { injection } = vertices.get(id);
    const frame = { id, cursor: 0, time: visited.size, low: visited.size, sum: injection };
    visited.set(id, frame);
    stack.push(frame);
  }
  visit(first);
  while (stack.length) {
    const frame = stack.at(-1);
    const parent = stack[stack.length - 2];
    const edges = vertices.get(frame.id).edges;
    if (frame.cursor < edges.length) {
      const next = edges[frame.cursor++];
      if (next === parent?.id) continue;
      if (visited.has(next)) frame.low = Math.min(frame.low, visited.get(next).time);
      else visit(next);
      continue;
    }
    stack.pop();
    if (!parent) continue;
    if (frame.low > parent.time && Math.abs(frame.sum) > tolerance) {
      const from = frame.sum > 0 ? frame.id : parent.id;
      const to = frame.sum > 0 ? parent.id : frame.id;
      cuts.push({ from, to, amperes: Math.abs(frame.sum) });
    }
    parent.low = Math.min(parent.low, frame.low);
    parent.sum += frame.sum;
  }
  return visited.size === vertices.size && cuts.every(({ amperes }) => Number.isFinite(amperes)) ? cuts : [];
}

function joinRuns(cuts, vertices, nodeId, tolerance) {
  const starts = new Map();
  const ends = new Map();
  for (const cut of cuts) {
    if (!starts.has(cut.from)) starts.set(cut.from, []);
    if (!ends.has(cut.to)) ends.set(cut.to, []);
    starts.get(cut.from).push(cut);
    ends.get(cut.to).push(cut);
  }
  function continuation(vertex, previous) {
    const outgoing = starts.get(vertex);
    if (outgoing?.length !== 1 || ends.get(vertex)?.length !== 1 ||
        Math.abs(previous.amperes - outgoing[0].amperes) > tolerance) return null;
    return outgoing[0];
  }
  return cuts.filter((cut) => !ends.has(cut.from) || continuation(cut.from, ends.get(cut.from)[0]) !== cut)
    .map((start) => {
      const points = [vertices.get(start.from).point];
      for (let cut = start; cut; cut = continuation(cut.to, cut)) points.push(vertices.get(cut.to).point);
      return { id: JSON.stringify([nodeId, start.from, start.to]), nodeId, points, amperes: start.amperes };
    });
}

/** Map solved component currents to physical conductor segments with unique currents. */
export function mapDcCurrentParticles(graph, layout, step) {
  const flows = step?.branchFlows;
  if (step?.currentArrowMode !== 'actual' || !Array.isArray(flows) ||
      !layout?.ok || layout.incomplete || layout.renderValidation?.isValid === false ||
      !graph || graph.incomplete || graph.reconstruction_incomplete || graph.validation?.isValid === false ||
      graph.provisional?.length || graph.topology?.provisional?.length ||
      graph.topology?.edges?.some((edge) => edge.confirmed === false) ||
      flows.length !== graph.components.filter(({ type }) => type !== 'ground').length) return [];
  const parts = new Map(layout.components.map((component) => [component.id, component]));
  const solved = new Map(flows.map((branch) => [branch.componentId, branch]));
  const nodeScale = new Map();
  for (const { fromNodeId, toNodeId, current } of flows) {
    for (const id of [fromNodeId, toNodeId]) nodeScale.set(id, Math.max(Math.abs(current), nodeScale.get(id) ?? 0));
  }
  const terminals = new Map(graph.nodes.map(({ id }) => [id, new Map()]));
  for (const component of graph.components) {
    const branch = solved.get(component.id);
    const rendered = parts.get(component.id);
    if (rendered?.type !== component.type) return [];
    const ground = component.type === 'ground';
    if (!ground && (!branch || !Number.isFinite(branch.current) || branch.fromTerminal === branch.toTerminal)) return [];
    const ends = ground ? component.terminals.map(({ label, node }) => [label, node, 0]) : [[branch.fromTerminal, branch.fromNodeId, -branch.current],
      [branch.toTerminal, branch.toNodeId, branch.current]];
    const hasSignal = !ground && (branch.sourceCurrent != null ? branch.sourceCurrent !== 0
      : displayZero(branch.current, Math.max(nodeScale.get(branch.fromNodeId), nodeScale.get(branch.toNodeId))) !== 0);
    if (component.terminals.length !== (ground ? 1 : 2)) return [];
    for (const [label, node, injection] of ends) {
      const point = rendered.terminals.find((t) => t.label === label && t.node === node);
      if (!finitePoint(point) || !component.terminals.some((t) => t.label === label && t.node === node) ||
          !terminals.has(node)) return [];
      terminals.get(node).set(termKey(component.id, label), { point, injection, hasSignal });
    }
  }

  const anchors = new Map(layout.nodes.map((node) => [node.id, node]));
  const wires = layout.allWires ?? layout.wires ?? [];
  return graph.nodes.flatMap(({ id, members }) => {
    const anchor = anchors.get(id);
    const ports = terminals.get(id);
    const drawn = new Set(anchor?.members);
    if (!anchor || ports.size !== members.length || drawn.size !== members.length ||
        members.some((member) => !ports.has(member) || !drawn.has(member))) return [];
    // Leave the signed injections intact for wire-current balance. An entire
    // net driven only by roundoff does not need an animated trace.
    if (![...ports.values()].some(({ hasSignal }) => hasSignal)) return [];
    const injections = [...ports.values()].map(({ injection }) => injection);
    const scale = injections.reduce((max, amps) => Math.max(max, Math.abs(amps)), 0);
    const balance = injections.reduce((sum, amps) => sum + amps, 0);
    if (!scale || !Number.isFinite(balance) || Math.abs(balance) > 1e-8 * scale) return [];
    const junctions = (layout.junctions ?? [])
      .filter((j) => j.nodeId === id && j.isRealJunction !== false && j.isJunction !== false);
    const net = physicalNet(ports, wires.filter((wire) => wire.node === id), anchor, junctions);
    const tolerance = 64 * Number.EPSILON * ports.size * scale;
    return net && net.size > 1 ? joinRuns(directedCuts(net, tolerance), net, id, tolerance) : [];
  });
}

/** Join verified wire runs through a resistor only when both terminal routes
 * agree with its signed branch current. Each chain is drawn as one polyline. */
export function stitchResistorParticleRuns(layout, flows, wireRuns) {
  if (!wireRuns.length) return wireRuns;
  const byId = new Map(flows.map((branch) => [branch.componentId, branch]));
  const starts = new Map();
  const ends = new Map();
  const ports = new Map();
  const key = (node, point) => JSON.stringify([node, point.x, point.y]);
  function add(index, id, entry) {
    if (!index.has(id)) index.set(id, []);
    index.get(id).push(entry);
  }
  for (const run of wireRuns) {
    add(starts, key(run.nodeId, run.points[0]), run);
    add(ends, key(run.nodeId, run.points.at(-1)), run);
  }
  for (const part of layout.components) {
    for (const terminal of part.terminals) add(ports, key(terminal.node, terminal), terminal);
  }

  const links = new Map();
  const preceded = new Set();
  for (const part of layout.components) {
    if (part.type !== 'resistor' || part.bodyOverhang) continue;
    const solved = byId.get(part.id);
    if (!solved || !Number.isFinite(solved.current) || solved.current === 0 || solved.fromNodeId === solved.toNodeId) continue;
    const forward = solved.current > 0;
    const input = part.terminals.find(({ label }) => label === (forward ? solved.fromTerminal : solved.toTerminal));
    const output = part.terminals.find(({ label }) => label === (forward ? solved.toTerminal : solved.fromTerminal));
    if (!input || !output || input.node !== (forward ? solved.fromNodeId : solved.toNodeId) ||
        output.node !== (forward ? solved.toNodeId : solved.fromNodeId)) continue;
    const inputKey = key(input.node, input);
    const outputKey = key(output.node, output);
    if (ports.get(inputKey)?.length !== 1 || ports.get(outputKey)?.length !== 1 ||
        ends.get(inputKey)?.length !== 1 || starts.get(outputKey)?.length !== 1) continue;
    const [incoming] = ends.get(inputKey);
    const [outgoing] = starts.get(outputKey);
    const amps = Math.abs(solved.current);
    if (links.has(incoming) || preceded.has(outgoing) ||
        [incoming, outgoing].some(({ amperes }) => Math.abs(amperes - amps) > 1e-8 * amps)) continue;

    const { from, to, body } = resistorGeometry(part);
    if (![from, to, ...body].every(finitePoint)) continue;
    const inputIsFirst = distance(input, from) <= EPSILON && distance(output, to) <= EPSILON;
    if (!inputIsFirst && !(distance(input, to) <= EPSILON && distance(output, from) <= EPSILON)) continue;
    links.set(incoming, { outgoing, body: inputIsFirst ? body : body.reverse(), id: part.id });
    preceded.add(outgoing);
  }

  const consumed = new Set();
  const stitched = wireRuns.filter((run) => !preceded.has(run)).map((first) => {
    consumed.add(first);
    if (!links.has(first)) return first;
    const points = [...first.points];
    const resistorIds = [];
    for (let link = links.get(first); link && !consumed.has(link.outgoing); link = links.get(link.outgoing)) {
      for (const p of [...link.body, ...link.outgoing.points]) {
        if (distance(points.at(-1), p) > EPSILON) points.push(p);
      }
      resistorIds.push(link.id);
      consumed.add(link.outgoing);
    }
    return { ...first, points, resistorIds };
  });
  // An unanchored closed chain has no unambiguous phase origin.
  return [...stitched, ...wireRuns.filter((run) => !consumed.has(run))];
}

const playbackRates = { slow: 0.55, normal: 1, fast: 1.6 };
export const PARTICLE_SPACING = 10;

export function dcParticleDuration(amperes, largest, rate) {
  // Square root compresses the range, and a floor keeps small nonzero
  // currents readable. Durations are illustrative rather than drift speeds.
  const relative = Math.sqrt(amperes / largest);
  const speed = (20 + 24 * relative) * playbackRates[rate];
  return PARTICLE_SPACING / speed;
}
