import { labelBoxAt, NODE_LABEL_FONT_SIZE, segmentIntersectsBox } from './labelMetrics.js';

const offsets = [[1, -1], [-1, -1], [1, 1], [-1, 1], [1, 0], [-1, 0], [0, -1], [0, 1]];
const clearance = 6;
const markerSize = { width: 8, height: 8 };

function overlaps(a, b, gap) {
  return a.minX < b.maxX + gap && a.maxX + gap > b.minX &&
    a.minY < b.maxY + gap && a.maxY + gap > b.minY;
}

function isBend(a, b, c) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ex = c.x - b.x;
  const ey = c.y - b.y;
  const lengths = Math.hypot(dx, dy) * Math.hypot(ex, ey);
  return lengths > 0 && Math.abs(dx * ey - dy * ex) > lengths * 0.05;
}

/** Place one annotation per node on visible geometry, independent of routing handles. */
export function placeNodeLabels(
  { nodes = [], components = [], junctions = [], wires, allWires, bounds },
  fontSize = NODE_LABEL_FONT_SIZE,
) {
  if (!bounds) return [];
  const candidates = new Map(nodes.map(({ id }) => [id, new Map()]));
  const visibleJunctions = junctions.filter((j) => j.isJunction !== false && j.isRealJunction !== false);
  const junctionAt = new Map(visibleJunctions.map((j) => [`${j.nodeId ?? j.id}:${j.x},${j.y}`, j.id]));
  const add = (id, { x, y }, kind, priority) => {
    const bucket = candidates.get(id);
    const key = `${x},${y}`;
    if (!bucket || !Number.isFinite(x) || !Number.isFinite(y) ||
        (bucket.has(key) && bucket.get(key).priority <= priority)) return;
    bucket.set(key, { x, y, kind, priority, junctionId: junctionAt.get(`${id}:${key}`) });
  };
  for (const junction of visibleJunctions) {
    if (junction.isBranchPoint || junction.source === 'branch') {
      add(junction.nodeId ?? junction.id, junction, 'junction', 0);
    }
  }
  const segments = [];
  const neighbors = new Map(nodes.map(({ id }) => [id, new Map()]));
  for (const { node, points } of allWires ?? wires ?? []) {
    const byPoint = neighbors.get(node);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      segments.push([a, b]);
      if (!byPoint || (a.x === b.x && a.y === b.y)) continue;
      for (const [point, neighbor] of [[a, b], [b, a]]) {
        const key = `${point.x},${point.y}`;
        if (!byPoint.has(key)) byPoint.set(key, { point, neighbors: [] });
        byPoint.get(key).neighbors.push(neighbor);
      }
    }
  }
  for (const [node, byPoint] of neighbors) {
    for (const { point, neighbors: [first, ...others] } of byPoint.values()) {
      if (others.some((other) => isBend(first, point, other))) add(node, point, 'corner', 1);
    }
  }
  for (const component of components) {
    for (const terminal of component.terminals) add(terminal.node, terminal, 'terminal', 2);
  }
  const boxes = components.flatMap((c) => [c.symbolBox, c.labelBox]).filter(Boolean);
  for (const junction of visibleJunctions) boxes.push(labelBoxAt(junction, { width: 12, height: 12 }));

  const labels = [];
  for (const [nodeId, bucket] of candidates) {
    const anchors = [...bucket.values()].sort((a, b) => a.priority - b.priority || a.y - b.y || a.x - b.x);
    const width = nodeId.length * fontSize * 0.65;
    const height = fontSize + 2;
    let best;
    for (const anchor of anchors) {
      for (const gap of [9, 15, 22, 32, 46, 64]) {
        for (const [horizontal, vertical] of offsets) {
          const center = {
            x: anchor.x + horizontal * (gap + width / 2),
            y: anchor.y + vertical * (gap + height / 2),
          };
          const box = labelBoxAt(center, { width, height });
          if (box.minX < 3 || box.minY < 3 || box.maxX > bounds.width - 3 || box.maxY > bounds.height - 3) continue;
          const conflicts = boxes.filter((obstacle) => overlaps(box, obstacle, clearance)).length +
            segments.filter(([a, b]) => segmentIntersectsBox(a, b, box, 3)).length;
          if (!best || conflicts < best.conflicts) best = {
            nodeId, anchor, box, markerBox: labelBoxAt(anchor, markerSize), conflicts,
          };
          if (conflicts === 0) break;
        }
        if (best?.conflicts === 0) break;
      }
      if (best?.conflicts === 0) break;
    }
    if (best) {
      const { box, markerBox } = best;
      boxes.push(box, markerBox);
      labels.push(best);
    }
  }
  return labels;
}
