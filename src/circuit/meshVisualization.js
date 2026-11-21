const EPSILON = 1e-6;
const key = ({ x, y }) => `${x},${y}`;
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const pointOn = (p, a, b) => Math.abs(cross(a, b, p)) < EPSILON &&
  p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
  p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');

function intersects(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (abC * abD < 0 && cdA * cdB < 0) || pointOn(a, c, d) || pointOn(b, c, d) ||
    pointOn(c, a, b) || pointOn(d, a, b);
}

function crossesBoundary(a, b, c, d) {
  if (![key(a), key(b)].some((end) => end === key(c) || end === key(d))) return intersects(a, b, c, d);
  // A common endpoint is fine. Collinear conductors that also share a span
  // are not, including when one is a strict subsegment of the other.
  if (Math.abs(cross(a, b, c)) >= EPSILON || Math.abs(cross(a, b, d)) >= EPSILON) return false;
  const axis = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y';
  return Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
    Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) > EPSILON;
}

function inside(point, edges) {
  if (edges.some(({ a, b }) => pointOn(point, a, b))) return false;
  let result = false;
  for (const { a, b } of edges) {
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < a.x + (point.y - a.y) * (b.x - a.x) / (b.y - a.y)) result = !result;
  }
  return result;
}

function isSimpleBoundary(edges) {
  if (edges.length < 3 || new Set(edges.map(({ a }) => key(a))).size !== edges.length) return false;
  let twiceArea = 0;
  for (const [i, { a, b }] of edges.entries()) {
    twiceArea += a.x * b.y - a.y * b.x;
    const next = edges[(i + 1) % edges.length];
    if (key(b) !== key(next.a) || crossesBoundary(a, b, next.a, next.b)) return false;
    for (let j = i + 2; j < edges.length; j += 1) {
      if (i === 0 && j === edges.length - 1) continue;
      if (intersects(a, b, edges[j].a, edges[j].b)) return false;
    }
  }
  return Math.abs(twiceArea) > EPSILON;
}

function drawingEdges(layout, eligibleWireIds) {
  const byNode = new Map();
  const allWires = layout.allWires ?? layout.wires ?? [];
  function bucket(node) {
    if (!byNode.has(node)) byNode.set(node, { points: new Map(), edges: new Map(), neighbors: new Map() });
    return byNode.get(node);
  }
  for (const wire of allWires) {
    for (const point of wire.points) bucket(wire.node).points.set(key(point), point);
  }
  for (const { terminals } of layout.components) {
    for (const terminal of terminals) bucket(terminal.node).points.set(key(terminal), terminal);
  }
  for (const wire of allWires) {
    const { points, edges } = bucket(wire.node);
    for (let i = 1; i < wire.points.length; i += 1) {
      const a = wire.points[i - 1];
      const b = wire.points[i];
      if (key(a) === key(b)) continue;
      const split = [...points.values()].filter((p) => pointOn(p, a, b))
        .sort((p, q) => (p.x - q.x) * (b.x - a.x) + (p.y - q.y) * (b.y - a.y));
      for (let j = 1; j < split.length; j += 1) {
        const id = `${wire.node}:${edgeKey(split[j - 1], split[j])}`;
        const eligible = eligibleWireIds.has(wire.id);
        if (!edges.has(id)) edges.set(id, { id, a: split[j - 1], b: split[j], eligible });
        else if (eligible) edges.get(id).eligible = true;
      }
    }
  }
  for (const { edges, neighbors } of byNode.values()) {
    for (const edge of edges.values()) {
      if (!edge.eligible) continue;
      for (const from of [edge.a, edge.b]) {
        const at = key(from);
        if (!neighbors.has(at)) neighbors.set(at, []);
        neighbors.get(at).push(key(edge.a) === at ? edge : { ...edge, a: edge.b, b: edge.a });
      }
    }
  }
  return byNode;
}

function uniquePath(neighbors, start, finish) {
  const from = key(start);
  const to = key(finish);
  function search(excluded) {
    const previous = new Map([[from, null]]);
    const queue = [from];
    for (let i = 0; i < queue.length && !previous.has(to); i += 1) {
      for (const edge of neighbors.get(queue[i]) ?? []) {
        const next = key(edge.b);
        if (edge.id === excluded || previous.has(next)) continue;
        previous.set(next, edge);
        queue.push(next);
      }
    }
    return previous;
  }
  const previous = search();
  if (!previous.has(to)) return null;
  const path = [];
  for (let current = to; current !== from;) {
    const edge = previous.get(current);
    if (search(edge.id).has(to)) return null;
    path.unshift(edge);
    current = key(edge.a);
  }
  return path;
}

function faceBoundary(mesh, components, nets, drawing) {
  const edges = [];
  for (const { componentId, fromNodeId, toNodeId } of mesh.boundary) {
    const component = components.get(componentId);
    if (!component || fromNodeId === toNodeId) return null;
    const a = component.terminals.find(({ node }) => node === fromNodeId);
    const b = component.terminals.find(({ node }) => node === toNodeId);
    if (!a || !b || key(a) === key(b)) return null;
    edges.push({ id: `part:${componentId}`, componentId, a, b });
  }
  const boundary = [];
  for (const [i, edge] of edges.entries()) {
    const next = edges[(i + 1) % edges.length];
    if (edge.b.node !== next.a.node) return null;
    const route = uniquePath(nets.get(edge.b.node)?.neighbors ?? new Map(), edge.b, next.a);
    if (!route) return null;
    boundary.push(edge, ...route);
  }
  if (!isSimpleBoundary(boundary)) return null;
  const used = new Set(boundary.map(({ id }) => id));
  // A simple cycle can enclose other branches. In that case it is not the
  // same face in the screenshot, even if its abstract endpoints all match.
  if (drawing.some(({ id, a, b }) => !used.has(id) &&
      ([a, b, midpoint(a, b)].some((p) => inside(p, boundary)) ||
        boundary.some((side) => crossesBoundary(a, b, side.a, side.b))))) return null;
  return boundary;
}

/** Verify the oriented mesh(s) against the SVG geometry. No inferred routes. */
export function mapMeshFaces(layout, meshes, componentIds, wireIds) {
  const components = new Map(layout.components.filter(({ id }) => componentIds.has(id)).map((c) => [c.id, c]));
  const nets = drawingEdges(layout, wireIds);
  const drawing = [...nets.values()].flatMap(({ edges }) => [...edges.values()]);
  drawing.push(...layout.components.filter(({ terminals }) => terminals.length === 2)
    .map(({ id, terminals: [a, b] }) => ({ id: `part:${id}`, a, b })));
  return new Map(meshes.map((mesh) => [mesh.id, faceBoundary(mesh, components, nets, drawing)]));
}

export function combineMeshBoundaries(boundaries) {
  if (boundaries.some((boundary) => !boundary)) return null;
  const perimeter = new Map();
  for (const edge of boundaries.flat()) {
    if (!perimeter.has(edge.id)) perimeter.set(edge.id, edge);
    else if (key(perimeter.get(edge.id).a) === key(edge.b)) perimeter.delete(edge.id);
    else return null;
  }
  const outgoing = new Map([...perimeter.values()].map((edge) => [key(edge.a), edge]));
  if (outgoing.size !== perimeter.size || !outgoing.size) return null;
  const boundary = [];
  let at = outgoing.keys().next().value;
  while (outgoing.has(at)) {
    const edge = outgoing.get(at);
    outgoing.delete(at);
    boundary.push(edge);
    at = key(edge.b);
  }
  return outgoing.size === 0 && isSimpleBoundary(boundary) ? boundary : null;
}

function distanceToEdge({ x, y }, { a, b }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
}

function distanceToBox({ x, y }, box) {
  return Math.hypot(Math.max(0, box.minX - x, x - box.maxX), Math.max(0, box.minY - y, y - box.maxY));
}

function interiorCenter(boundary, boxes, placed) {
  const xs = boundary.map(({ a }) => a.x);
  const ys = boundary.map(({ a }) => a.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const dx = (Math.max(...xs) - x) / 20;
  const dy = (Math.max(...ys) - y) / 20;
  let best = null;
  function consider(point) {
    if (!inside(point, boundary)) return;
    const clearance = Math.min(...boundary.map((edge) => distanceToEdge(point, edge)),
      ...boxes.map((box) => distanceToBox(point, box)),
      ...placed.map(({ center, footprint }) => Math.hypot(point.x - center.x, point.y - center.y) - footprint));
    if (clearance > (best?.clearance ?? 0)) best = { ...point, clearance };
  }
  // Search the actual face, then refine around its best open patch. Clearance
  // bounds the entire circle, including its head.
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 20; col += 1) consider({ x: x + (col + 0.5) * dx, y: y + (row + 0.5) * dy });
  }
  for (let factor = 0.5; best && factor >= 0.125; factor /= 2) {
    const center = best;
    for (const row of [-1, 0, 1]) {
      for (const col of [-1, 0, 1]) consider({ x: center.x + col * dx * factor, y: center.y + row * dy * factor });
    }
  }
  return best;
}

// Accept only faces already verified against the drawing.
export function placeMeshCurrentArrows(faces, layout, nodeLabels = [], preferredFontSize = 13) {
  if (!faces?.length) return [];
  const margin = 7;
  const boxes = [
    ...layout.components.flatMap(({ drawBox, symbolBox, labelBox }) => [drawBox ?? symbolBox, labelBox]),
    ...nodeLabels.flatMap(({ box, markerBox }) => [box, markerBox]),
  ].filter(Boolean);
  const arrows = [];
  for (const { meshId, boundary, emphasized } of faces.toSorted((a, b) => Number(b.emphasized) - Number(a.emphasized))) {
    const best = interiorCenter(boundary, boxes, arrows);
    const radius = Math.min(preferredFontSize * 1.9, (best?.clearance ?? 0) - margin);
    const fontSize = Math.min(preferredFontSize, radius / (0.65 + 0.21 * meshId.length));
    if (radius < 13 || fontSize < 13) continue;
    const { x, y } = best;
    // SVG y increases downwards. A mirrored drawing reverses the sweep while
    // the ordered branch traversal (the equation's reference) stays the same.
    const signedArea = boundary.reduce((sum, { a, b }) => sum + (a.x - x) * (b.y - y) - (a.y - y) * (b.x - x), 0);
    if (Math.abs(signedArea) < EPSILON) continue;
    const clockwise = signedArea > 0;
    const sign = clockwise ? 1 : -1;
    const endAngle = -Math.PI / 4;
    const startAngle = endAngle + sign * Math.PI / 3;
    const pointAt = (angle) => ({ x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) });
    const start = pointAt(startAngle);
    const end = pointAt(endAngle);
    const tangent = { x: -sign * Math.sin(endAngle), y: sign * Math.cos(endAngle) };
    const length = Math.min(7, radius * 0.45);
    const head = [-1, 1].map((side) => ({
      x: end.x - tangent.x * length + side * tangent.y * 3.4,
      y: end.y - tangent.y * length - side * tangent.x * 3.4,
    }));
    arrows.push({ meshId, emphasized, clockwise, center: { x, y }, radius, footprint: radius + margin, start, end, head, fontSize });
  }
  return arrows;
}
