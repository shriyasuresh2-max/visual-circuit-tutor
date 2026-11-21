import { prepareDcNetwork, solveDcCircuit } from './dcSolver.js';
import { solveDcSeriesParallel } from './dcSeriesParallelSolver.js';
import { termKey } from './electricalGraph.js';

const ordered = (items) => [...items].sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id));
const ends = ({ from, to }) => [from.node, to.node];
const issue = (code, message, details = {}) => ({ code, message, ...details });
const method = 'source-transformation';

function findPair(source, branches, originalComponents) {
  const [from, to] = ends(source);
  if (from === to) return null;
  const resistors = branches.filter(({ id, kind }) => kind === 'resistance' && originalComponents.has(id));
  if (source.kind === 'current') {
    const resistor = resistors.find((branch) =>
      ends(branch).includes(from) && ends(branch).includes(to));
    return resistor ? { resistor, a: to, b: from } : null;
  }
  // Either end of the voltage source may face the private series junction.
  for (const resistor of resistors) {
    const [rFrom, rTo] = ends(resistor);
    if (rFrom === rTo) continue;
    const shared = [from, to].filter((node) => node === rFrom || node === rTo);
    if (shared.length !== 1) continue;
    const [junction] = shared;
    if (branches.filter((branch) => ends(branch).includes(junction)).length !== 2) continue;
    const outer = rFrom === junction ? rTo : rFrom;
    return { resistor, junction, a: from === junction ? outer : from, b: to === junction ? outer : to };
  }
  return null;
}

function circuitGraph(branches, originalComponents) {
  const members = new Map();
  const components = branches.map(({ id, type, kind, value, from, to }) => {
    for (const { node, label } of [from, to]) {
      if (!members.has(node)) members.set(node, []);
      members.get(node).push(termKey(id, label));
    }
    const original = originalComponents.get(id);
    // A transformed graph has electrical membership only. Geometry and the
    // original extraction's topology and diagnostics belong to the upload.
    return original ? {
      id, type, value, terminals: original.terminals.map(({ label, node }) => ({ label, node })),
      ...(kind === 'current' ? { currentDirection: { fromTerminal: from.label, toTerminal: to.label } } : {}),
    } : {
      id, type, value, terminals: [{ ...from }, { ...to }],
      ...(kind === 'current' ? { currentDirection: { fromTerminal: from.label, toTerminal: to.label } } : {}),
    };
  });
  return { components, nodes: ordered([...members].map(([id, keys]) => ({ id, members: keys.sort() }))) };
}

const newBranch = (id, type, kind, value, from, to, labels) => ({
  id, type, kind, value, from: { node: from, label: labels[0] }, to: { node: to, label: labels[1] },
});

function equivalentBranchCheck(source, equivalent, resistance) {
  // Both forms have v(A)−v(B) = openVoltage − resistance × deliveredCurrent.
  // Derive open-circuit and short-circuit values independently for each form.
  const signature = ({ kind, value }) => kind === 'voltage'
    ? { openVoltage: value, shortCurrent: value / resistance }
    : { openVoltage: value * resistance, shortCurrent: value };
  const original = signature(source);
  const transformed = signature(equivalent);
  for (const key of Object.keys(original)) {
    const left = original[key];
    const right = transformed[key];
    if (!Number.isFinite(left) || !Number.isFinite(right) || (left === 0) !== (right === 0) ||
        Math.abs(left - right) > 1e-12 * Math.max(Math.abs(left), Math.abs(right))) return null;
  }
  if (source.value !== 0 && equivalent.value === 0) return null;
  return { original, transformed, resistance };
}

function verifyNetwork(original, transformedGraph, originalIds) {
  const anchor = transformedGraph.nodes.some(({ id }) => id === original.referenceNodeId)
    ? original.referenceNodeId : transformedGraph.nodes.find(({ id }) => original.nodes.some((node) => node.id === id)).id;
  const transformed = solveDcCircuit(transformedGraph, { referenceNodeId: anchor });
  if (!transformed.ok) return { status: 'unavailable', issues: transformed.issues };

  const originalVolts = new Map(original.nodes.map(({ id, voltage }) => [id, voltage]));
  const shift = originalVolts.get(anchor);
  const volts = Math.max(...original.nodes.map(({ voltage }) => Math.abs(voltage)));
  const amps = Math.max(...original.branches.map(({ current }) => Math.abs(current)));
  const compatible = (a, b, scale) => Number.isFinite(a - b) &&
    Math.abs(a - b) <= 1e-8 * Math.max(Math.abs(a), Math.abs(b)) + 64 * Number.EPSILON * scale;
  const transformedById = new Map(transformed.branches.map((branch) => [branch.componentId, branch]));
  const voltagesAgree = transformed.nodes.every(({ id, voltage }) =>
    !originalVolts.has(id) || compatible(voltage, originalVolts.get(id) - shift, volts));
  const currentsAgree = original.branches.filter(({ componentId }) => !originalIds.has(componentId))
    .every(({ componentId, current }) => compatible(current, transformedById.get(componentId)?.current, amps));
  return voltagesAgree && currentsAgree ? { status: 'verified', transformed } : {
    status: 'mismatch', issues: [issue('verification-mismatch', 'The original and transformed MNA results disagree at a shared node or an untouched branch.')],
  };
}

/** Replace each eligible original pair at most once, in stable ID order. */
export function transformDcSources(graph, { direction, target } = {}) {
  const network = prepareDcNetwork(graph);
  if (!network.ok) return { ...network, method, status: 'invalid' };

  const originals = new Map(graph.components.map((component) => [component.id, component]));
  let branches = ordered(network.branches);
  const sources = branches.filter(({ kind }) => kind !== 'resistance');
  const named = target ? sources.filter(({ id }) => id === target) : [];
  const matches = target && !named.length ? sources.filter(({ id }) => id.toLowerCase() === target.toLowerCase()) : named;
  const selected = sources.filter(({ id, kind }) => (!direction || kind === direction) && (!target || matches.length === 1 && matches[0].id === id));
  if (!selected.length) return { ok: false, method, status: 'unsupported', issues: [issue('no-matching-source',
    target ? `No unique matching source for ${target}. Check the source ID and type.` : 'The circuit has no independent source of the requested type.')] };

  const used = new Set([...network.nodeIds, ...originals.keys()]);
  let serial = 0;
  function makeId(prefix) {
    let id;
    do { id = `ST-${prefix}-${++serial}`; } while (used.has(id));
    used.add(id);
    return id;
  }

  const steps = [];
  const issues = [];
  const replaced = new Set();
  for (const source of selected) {
    // Only original resistors are eligible partners. Generated components
    // still count as branches when checking a private series junction.
    const pair = findPair(source, branches, originals);
    if (!pair) {
      issues.push(issue('no-valid-pair', source.kind === 'voltage'
        ? `${source.id} has no available original resistor in series at an unbranched junction with distinct external terminals.`
        : `${source.id} has no available original resistor across the same two distinct nodes.`, { componentId: source.id }));
      continue;
    }

    const { a, b, resistor, junction } = pair;
    const resistance = resistor.value;
    const convertsVoltage = source.kind === 'voltage';
    const internalNodeId = convertsVoltage ? undefined : makeId('node');
    const equivalentSource = convertsVoltage
      ? newBranch(makeId('I'), 'current_source', 'current', source.value / resistance, b, a, ['B', 'A'])
      : newBranch(makeId('V'), 'voltage_source', 'voltage', source.value * resistance, a, internalNodeId, ['+', '−']);
    const equivalentResistor = newBranch(makeId('R'), 'resistor', 'resistance', resistance, internalNodeId ?? a, b, ['A', 'B']);
    const terminalBehavior = equivalentBranchCheck(source, equivalentSource, resistance);
    if (!terminalBehavior) {
      issues.push(issue('numerical-range', `The equivalent for ${source.id} cannot be represented reliably at this numerical scale.`, { componentId: source.id }));
      continue;
    }

    const originalComponentIds = [source.id, resistor.id];
    for (const id of originalComponentIds) replaced.add(id);
    branches = ordered([...branches.filter(({ id }) => !originalComponentIds.includes(id)), equivalentSource, equivalentResistor]);
    steps.push({
      id: equivalentSource.id, direction: convertsVoltage ? 'voltage-to-current' : 'current-to-voltage',
      a, b, original: { source, resistor, internalNodeId: junction },
      equivalent: { source: equivalentSource, resistor: equivalentResistor, internalNodeId },
      originalComponentIds, equivalentComponentIds: [equivalentSource.id, equivalentResistor.id], terminalBehavior,
    });
  }
  if (!steps.length) return { ok: false, method, status: 'unsupported', issues };

  const transformedGraph = circuitGraph(branches, originals);
  const originalResult = solveDcCircuit(graph);
  const verification = originalResult.ok ? verifyNetwork(originalResult, transformedGraph, replaced) : { status: 'unavailable' };
  // Apply existing resistor-reduction rules only to the equivalent network.
  // Prefer no downstream lesson over showing reductions on a disputed solve.
  const reduction = verification.status === 'verified' ? solveDcSeriesParallel(transformedGraph) : null;
  return { ok: true, method, status: issues.length || verification.status !== 'verified' ? 'partial' : 'transformed',
    steps, issues, transformedGraph, originalResult, verification, reductions: reduction?.ok ? reduction.steps : [] };
}
