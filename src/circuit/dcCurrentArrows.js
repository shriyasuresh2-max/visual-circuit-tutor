import { termKey } from './electricalGraph.js';
import { segmentIntersectsBox } from './labelMetrics.js';
import { placeNodeLabels } from './nodeLabels.js';

const HALF_SHAFT = 8;
const WIRE_OFFSET = 8;
const TERMINAL_TOLERANCE = 1;
const FONT_SIZE = 8;
const FLOW_REACH = 66;
const FLOW_CHECK_STEP = 4;
const FLOW_CLEARANCE = 2;
const move = (point, vector, distance) => ({ x: point.x + vector.x * distance, y: point.y + vector.y * distance });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const normalTo = (vector) => ({ x: -vector.y, y: vector.x });

function unitBetween(a, b) {
  const length = distance(a, b);
  return length > 0 && Number.isFinite(length) ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : null;
}

function around(point, halfWidth, halfHeight = halfWidth) {
  return {
    minX: point.x - halfWidth, maxX: point.x + halfWidth,
    minY: point.y - halfHeight, maxY: point.y + halfHeight,
  };
}

function boundsOf(points, padding) {
  return {
    minX: Math.min(...points.map(({ x }) => x)) - padding,
    maxX: Math.max(...points.map(({ x }) => x)) + padding,
    minY: Math.min(...points.map(({ y }) => y)) - padding,
    maxY: Math.max(...points.map(({ y }) => y)) + padding,
  };
}

function overlaps(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function drawingObstacles(layout, wires, nodeLabels) {
  const junctions = layout.junctions ?? [];
  const boxes = layout.components.flatMap((component) => [component.drawBox ?? component.symbolBox, component.labelBox]).filter(Boolean);
  boxes.push(...nodeLabels.flatMap(({ box, markerBox }) => [box, markerBox]));
  boxes.push(...junctions.map((junction) => around(junction, 8)));
  for (const crossing of layout.crossings ?? []) {
    const wire = wires.find(({ id }) => id === crossing.wireId);
    const point = crossing.point ?? wire?.points?.[Math.floor(wire.points.length / 2)];
    if (point) boxes.push(around(point, 8));
  }
  const segments = wires.flatMap((wire) => (wire.points ?? []).slice(1).map((b, i) => ({
    a: wire.points[i], b, index: i, wireId: wire.id, nodeId: wire.node,
  })));
  const terminalContacts = layout.components.flatMap((component) => component.terminals.map((terminal) => ({
    point: terminal, nodeId: terminal.node, key: termKey(component.id, terminal.label),
  })));
  const junctionContacts = junctions.filter((junction) => junction.isRealJunction !== false)
    .map((junction) => ({ point: junction, nodeId: junction.nodeId ?? junction.id }));
  return { boxes, segments, contacts: [...terminalContacts, ...junctionContacts], animated: [] };
}

function marker(base, axis, flowSign, clearanceNormal, offset, text, fontSize) {
  const center = move(base, clearanceNormal, offset);
  const start = move(center, axis, -flowSign * HALF_SHAFT);
  const end = move(center, axis, flowSign * HALF_SHAFT);
  const headBase = move(end, axis, -flowSign * 6);
  const head = [end, move(headBase, clearanceNormal, 3.5), move(headBase, clearanceNormal, -3.5)];
  const halfTextWidth = text.length * fontSize * 0.32 + 1;
  const halfTextHeight = fontSize / 2 + 1;
  const labelOffset = Math.abs(clearanceNormal.x) * halfTextWidth + Math.abs(clearanceNormal.y) * halfTextHeight + 5;
  const label = { ...move(center, clearanceNormal, labelOffset), text, fontSize };
  return {
    start, end, head, label,
    footprints: [boundsOf([start, ...head], 1.5), around(label, halfTextWidth, halfTextHeight)],
  };
}

function fits(candidate, obstacles, bounds) {
  return candidate.footprints.every((box) =>
    box.minX >= 2 && box.minY >= 2 && box.maxX <= bounds.width - 2 && box.maxY <= bounds.height - 2 &&
    !obstacles.boxes.some((other) => overlaps(box, other)) &&
    !obstacles.segments.some(({ a, b }) => segmentIntersectsBox(a, b, box)));
}

function markerAt(base, axis, sign, offset, label, obstacles, bounds) {
  const normal = normalTo(axis);
  for (const side of [1, -1]) {
    const candidate = marker(base, axis, sign, { x: side * normal.x, y: side * normal.y }, offset, label, FONT_SIZE);
    if (fits(candidate, obstacles, bounds)) return candidate;
  }
  return null;
}

/** Walk one uniquely attached polyline outward. A contact with another
 * same-net run ends the known branch path, even if it occurs before the
 * displayed part. The clipped path retains any clear bends it traverses. */
function terminalFlowPath(wire, fromStart, along, sign, obstacles, component) {
  const points = fromStart ? wire.points : wire.points.slice().reverse();
  const total = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
  const firstVisible = Math.max(6, along - HALF_SHAFT - 6);
  const lastVisible = Math.min(total - 7, firstVisible + FLOW_REACH);
  const terminalKey = fromStart ? wire.from : wire.to;
  const contacts = obstacles.contacts.filter(({ key, nodeId }) => key !== terminalKey && nodeId === wire.node);
  // The component's loose hit box extends sideways at its own terminal.
  // Clip to the symbol and label instead so a clear wire can leave that end.
  const visibleBoxes = obstacles.boxes.filter((box) => box !== component.drawBox);
  if (component.drawBox && component.symbolBox) visibleBoxes.push(component.symbolBox);
  const path = [];
  let walked = 0;
  let visibleLength = 0;
  let blocked = false;

  for (let i = 1; i < points.length && walked < lastVisible && !blocked; i += 1) {
    const start = points[i - 1];
    const end = points[i];
    const axis = unitBetween(start, end);
    if (!axis) continue;
    const length = distance(start, end);
    const limit = Math.min(length, lastVisible - walked);
    const visibleStart = Math.max(0, firstVisible - walked);
    const edgeIndex = fromStart ? i - 1 : wire.points.length - i - 1;
    const foreignRuns = obstacles.segments.filter((segment) =>
      segment.wireId !== wire.id || Math.abs(segment.index - edgeIndex) > 1);

    let reached = 0;
    while (reached < limit) {
      // Split at the start of the visible span so checking it cannot skip over
      // an obstacle between the terminal and the first dash.
      const boundary = reached < visibleStart ? Math.min(limit, visibleStart) : limit;
      const next = Math.min(boundary, reached + FLOW_CHECK_STEP);
      const box = boundsOf([move(start, axis, reached), move(start, axis, next)], FLOW_CLEARANCE);
      const visible = reached >= visibleStart;
      if (foreignRuns.some(({ a, b, nodeId }) =>
        (visible || nodeId === wire.node) && segmentIntersectsBox(a, b, box)) ||
        contacts.some(({ point }) => overlaps(box, around(point, 1))) ||
        (visible && (visibleBoxes.some((other) => overlaps(box, other)) ||
          obstacles.animated.some(([a, b]) => segmentIntersectsBox(a, b, box))))) {
        blocked = true;
        break;
      }
      reached = next;
    }

    if (reached > visibleStart) {
      if (path.length === 0) path.push(move(start, axis, visibleStart));
      path.push(move(start, axis, reached));
      visibleLength += reached - visibleStart;
    }
    walked += length;
  }
  if (visibleLength < 12) return null;
  return sign > 0 ? path : path.reverse();
}

/** Choose only a unique, terminal-adjacent wire leg before it joins another run. */
function terminalMarker(component, terminal, outwardSign, label, wires, wireIds, obstacles, bounds, showFlow) {
  const key = termKey(component.id, terminal.label);
  const attached = wires.filter((wire) => wire.node === terminal.node && (wire.from === key || wire.to === key));
  if (attached.length !== 1) return null;
  const [wire] = attached;
  if (!wireIds.has(wire.id) || wire.from === wire.to) return null;
  const points = wire.points;
  const first = wire.from === key ? points[0] : points.at(-1);
  const second = wire.from === key ? points[1] : points.at(-2);
  if (distance(first, terminal) > TERMINAL_TOLERANCE) return null;
  const axis = unitBetween(first, second);
  if (!axis) return null;

  let staticMarker = null;
  for (const along of [20, 27, 35, 43]) {
    if (along + HALF_SHAFT + 3 >= distance(first, second)) break;
    const prefix = boundsOf([first, move(first, axis, along + HALF_SHAFT + 2)], TERMINAL_TOLERANCE);
    // At a tee, no one continuation carries the full component current.
    if (obstacles.segments.some(({ a, b, wireId, nodeId }) => {
      const sameLeg = wireId === wire.id && ((a === first && b === second) || (b === first && a === second));
      return !sameLeg && nodeId === terminal.node && segmentIntersectsBox(a, b, prefix);
    })) break;
    const candidate = markerAt(move(first, axis, along), axis, outwardSign, WIRE_OFFSET, label, obstacles, bounds);
    if (!candidate) continue;
    const flowPath = showFlow ? terminalFlowPath(wire, wire.from === key, along, outwardSign, obstacles, component) : null;
    const placed = { ...candidate, wireId: wire.id, flowPath };
    if (!showFlow || flowPath) return placed;
    staticMarker ??= placed;
  }
  return staticMarker;
}

function componentMarker(component, from, to, sign, label, obstacles, bounds) {
  const axis = unitBetween(from, to);
  if (!axis || !component.symbolBox || distance(from, to) < 2) return null;
  const normal = normalTo(axis);
  const base = move(from, axis, distance(from, to) / 2);
  const { minX, maxX, minY, maxY } = component.symbolBox;
  const symbolHalf = (Math.abs(normal.x) * (maxX - minX) + Math.abs(normal.y) * (maxY - minY)) / 2;
  for (const gap of [8, 16, 24]) {
    const candidate = markerAt(base, axis, sign, symbolHalf + gap, label, obstacles, bounds);
    if (candidate) return { ...candidate, wireId: null };
  }
  return null;
}

/** Place static labels on verified branch leads, with a body-side fallback. */
export function placeDcCurrentArrows(layout, step, highlights, nodeLabels) {
  const mode = step?.currentArrowMode;
  if ((mode !== 'reference' && mode !== 'actual') || !highlights.active || layout.renderValidation?.isValid === false) return [];
  const wires = layout.allWires ?? layout.wires ?? [];
  const obstacles = drawingObstacles(layout, wires, nodeLabels ?? placeNodeLabels(layout));
  const components = new Map(layout.components.map((component) => [component.id, component]));
  const directions = step.currentDirections ?? [];
  const counts = new Map();
  for (const { branchId } of directions) counts.set(branchId, (counts.get(branchId) ?? 0) + 1);
  const arrows = [];
  for (const direction of directions) {
    const { componentId, branchId, signedCurrent } = direction;
    if (branchId !== componentId || !highlights.componentIds.has(componentId) || counts.get(branchId) !== 1) continue;
    if (mode === 'actual' && (!Number.isFinite(signedCurrent) || signedCurrent === 0 || direction.effectivelyZero)) continue;
    const component = components.get(componentId);
    const from = component?.terminals.find(({ label, node }) => label === direction.fromTerminal && node === direction.fromNodeId);
    const to = component?.terminals.find(({ label, node }) => label === direction.toTerminal && node === direction.toNodeId);
    if (!from || !to || from === to || !unitBetween(from, to)) continue;
    const sign = mode === 'actual' && signedCurrent < 0 ? -1 : 1;
    const label = `I_${branchId}`;
    // The reference enters the "from" terminal and leaves the "to" terminal.
    const showFlow = mode === 'actual';
    const outgoing = terminalMarker(component, to, sign, label, wires, highlights.wireIds, obstacles, layout.bounds, showFlow);
    const incoming = !outgoing || (showFlow && !outgoing.flowPath)
      ? terminalMarker(component, from, -sign, label, wires, highlights.wireIds, obstacles, layout.bounds, showFlow)
      : null;
    const candidate = incoming?.flowPath ? incoming : outgoing ?? incoming ??
      componentMarker(component, from, to, sign, label, obstacles, layout.bounds);
    if (!candidate) continue;
    const { footprints, ...arrow } = candidate;
    obstacles.boxes.push(...footprints);
    if (arrow.flowPath) {
      obstacles.animated.push(...arrow.flowPath.slice(1).map((point, i) => [arrow.flowPath[i], point]));
    }
    arrows.push({
      ...arrow, branchId, mode,
      fromTerminal: sign > 0 ? from.label : to.label,
      toTerminal: sign > 0 ? to.label : from.label,
    });
  }
  return arrows;
}
