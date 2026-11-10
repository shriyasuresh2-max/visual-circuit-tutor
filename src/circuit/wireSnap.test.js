/**
 * Focused tests for wire-endpoint snap detection.
 *
 * These exercise the pure detection module only: no React, no rendering, and
 * no electrical editing. The fixture is a real layout produced by the layout
 * engine, so the tests read whatever geometry the engine draws instead of
 * asserting coordinates for one picture.
 */

import { describe, it, expect } from 'vitest';
import { layoutSchematic, wireOverrideKey } from './schematicLayout.js';
import {
  DEFAULT_SNAP_DISTANCE,
  collectSnapTargets,
  findSnapTarget,
  projectOnSegment,
  snapDistanceForZoom,
  snapTargetLabel,
} from './wireSnap.js';

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
});

const geo = (id, type, value, t0, t1) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.95,
  center: { x: (t0[1] + t1[1]) / 2, y: (t0[2] + t1[2]) / 2 },
  terminals: [
    { label: t0[0], position: { x: t0[1], y: t0[2] } },
    { label: t1[0], position: { x: t1[1], y: t1[2] } },
  ],
});

// Two rail nodes, six wires with bends, and one genuine crossing between two
// wires of different nodes.
const geometricParallel = {
  contains_circuit: true,
  circuit_type: 'parallel',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.12, 0.3], ['−', 0.12, 0.62]),
    geo('R1', 'resistor', '4 Ω', ['A', 0.52, 0.22], ['B', 0.52, 0.36]),
    geo('R2', 'resistor', '6 Ω', ['A', 0.52, 0.58], ['B', 0.52, 0.72]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'),
    conn('V1', '+', 'R2', 'A'),
    conn('V1', '−', 'R1', 'B'),
    conn('V1', '−', 'R2', 'B'),
  ],
};

const layout = layoutSchematic(geometricParallel);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** All snap targets, so a test can assert what else was nearby. */
const allTargets = () => collectSnapTargets(layout, { x: 0, y: 0 });

const terminalOf = (compId, label) => {
  const comp = layout.components.find((c) => c.id === compId);
  return comp.terminals.find((t) => t.label === label);
};

/** A wire segment midpoint that is far from every other target. */
const cleanWirePoint = () => {
  let best = null;
  for (const wire of layout.allWires ?? layout.wires) {
    for (let i = 0; i < wire.points.length - 1; i += 1) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const others = collectSnapTargets(layout, mid).filter(
        (t) => !(t.type === 'wire' && t.wireId === wire.id),
      );
      const clearance = Math.min(...others.map((t) => t.distance));
      if (!best || clearance > best.clearance) {
        best = { wire, segmentIndex: i, mid, clearance };
      }
    }
  }
  return best;
};

describe('snap detection', () => {
  it('finds the component terminal under the endpoint', () => {
    const a = terminalOf('R1', 'A');
    const target = findSnapTarget(layout, { x: a.x, y: a.y - 4 });

    expect(target).not.toBeNull();
    expect(target.type).toBe('terminal');
    expect(target.componentId).toBe('R1');
    expect(target.terminalLabel).toBe('A');
    expect(target.terminalKey).toBe('R1.A');
    expect(target.nodeId).toBe(a.node);
    expect(target.point).toEqual({ x: a.x, y: a.y });
    expect(snapTargetLabel(target)).toBe('R1.A');
  });

  it('finds the junction dot under the endpoint', () => {
    const junction = layout.junctions[0];
    const target = findSnapTarget(layout, { x: junction.x + 3, y: junction.y + 3 });

    expect(target.type).toBe('junction');
    expect(target.nodeId).toBe(junction.nodeId);
    expect(layout.nodes.some((n) => n.id === target.nodeId)).toBe(true);
    expect(target.point).toEqual({ x: junction.x, y: junction.y });
  });

  it('finds the nearest point along an existing wire', () => {
    const clean = cleanWirePoint();
    expect(clean.clearance).toBeGreaterThan(DEFAULT_SNAP_DISTANCE);

    const target = findSnapTarget(layout, clean.mid);
    expect(target.type).toBe('wire');
    expect(target.wireId).toBe(clean.wire.id);
    expect(target.wireKey).toBe(wireOverrideKey(clean.wire));
    expect(target.segmentIndex).toBe(clean.segmentIndex);
    expect(dist(target.point, clean.mid)).toBeLessThan(0.01);

    // The projected point really lies on the segment it names.
    const { a, b } = target.segment;
    expect(projectOnSegment(target.point, a, b).distance).toBeLessThan(1e-6);
  });

  it('returns nothing outside the snap distance', () => {
    const clean = cleanWirePoint();
    const away = { x: clean.mid.x, y: clean.mid.y + 40 };
    expect(dist(away, clean.mid)).toBeGreaterThan(DEFAULT_SNAP_DISTANCE);

    expect(findSnapTarget(layout, away, { maxDistance: DEFAULT_SNAP_DISTANCE })).toBeNull();
    // ... and the same point does snap when the radius is large enough.
    expect(findSnapTarget(layout, away, { maxDistance: 60 })).not.toBeNull();
  });

  it('prefers the nearest of several nearby targets', () => {
    const r1b = terminalOf('R1', 'B');
    const r2a = terminalOf('R2', 'A');
    const between = (t) => ({ x: r1b.x, y: r1b.y + (r2a.y - r1b.y) * t });

    const closerToR2 = findSnapTarget(layout, between(0.6));
    expect(closerToR2.type).toBe('terminal');
    expect(closerToR2.terminalKey).toBe('R2.A');

    const closerToR1 = findSnapTarget(layout, between(0.3));
    expect(closerToR1.terminalKey).toBe('R1.B');

    // Same input, same answer: no dependence on iteration order or jitter.
    expect(findSnapTarget(layout, between(0.6))).toEqual(closerToR2);
  });

  it('never snaps the dragged wire to itself', () => {
    const clean = cleanWirePoint();
    const key = wireOverrideKey(clean.wire);

    const self = findSnapTarget(layout, clean.mid);
    expect(self.type).toBe('wire');
    expect(self.wireKey).toBe(key);

    // Everything else is more than one snap radius away here, so excluding the
    // dragged wire leaves nothing to snap to.
    const other = findSnapTarget(layout, clean.mid, { ignoreWireKeys: [key] });
    expect(other).toBeNull();
    expect(collectSnapTargets(layout, clean.mid, { ignoreWireKeys: [key] }).some(
      (t) => t.type === 'wire' && t.wireKey === key,
    )).toBe(false);
  });

  it('does not turn a drawn wire crossing into a junction', () => {
    const crossing = layout.crossings[0];
    expect(crossing).toBeTruthy();

    const near = collectSnapTargets(layout, crossing.point);
    // Nothing at a crossing may be offered as a junction ...
    expect(near.filter((t) => t.type === 'junction' && t.distance <= 2)).toEqual([]);
    // ... and the two wires passing through it are ambiguous, so ineligible.
    const atCrossing = near.filter((t) => t.type === 'wire' && t.distance <= 2);
    expect(atCrossing.length).toBeGreaterThan(0);
    expect(atCrossing.every((t) => t.eligible === false)).toBe(true);
    expect(findSnapTarget(layout, crossing.point)).toBeNull();

    // The crossing is only the crossing wires' business: neither node gains a
    // target there, and the graph is untouched.
    expect(layout.nodes.some((n) => dist(n, crossing.point) <= 2)).toBe(false);
  });

  it('scales the snap radius with the zoom level', () => {
    expect(snapDistanceForZoom(1)).toBe(DEFAULT_SNAP_DISTANCE);
    expect(snapDistanceForZoom(2)).toBe(DEFAULT_SNAP_DISTANCE / 2);
    expect(snapDistanceForZoom(4)).toBe(DEFAULT_SNAP_DISTANCE / 4);
    expect(snapDistanceForZoom(0)).toBe(DEFAULT_SNAP_DISTANCE);

    // 13 user units away: inside the radius at 100%, outside it at 200%,
    // because 200% halves the radius in user space.
    const a = terminalOf('R1', 'A');
    const point = { x: a.x, y: a.y - 13 };
    expect(findSnapTarget(layout, point)).not.toBeNull();
    expect(findSnapTarget(layout, point, { maxDistance: snapDistanceForZoom(2) })).toBeNull();

    const closer = { x: a.x, y: a.y - 8 };
    const target = findSnapTarget(layout, closer, { maxDistance: snapDistanceForZoom(2) });
    expect(target.type).toBe('terminal');
    expect(target.terminalKey).toBe('R1.A');
  });

  it('ignores out-of-bounds points and never mutates the layout', () => {
    const snapshot = JSON.stringify(layout);
    expect(findSnapTarget(layout, { x: -100, y: -100 })).toBeNull();
    expect(findSnapTarget(layout, { x: 99999, y: 99999 })).toBeNull();

    for (const target of allTargets()) {
      expect(target.point.x).toBeGreaterThanOrEqual(0);
      expect(target.point.y).toBeGreaterThanOrEqual(0);
      expect(target.point.x).toBeLessThanOrEqual(layout.bounds.width);
      expect(target.point.y).toBeLessThanOrEqual(layout.bounds.height);
    }

    // Detection is a read: no geometry, membership or connectivity changed.
    findSnapTarget(layout, terminalOf('R1', 'A'));
    cleanWirePoint();
    expect(JSON.stringify(layout)).toBe(snapshot);
  });
});
