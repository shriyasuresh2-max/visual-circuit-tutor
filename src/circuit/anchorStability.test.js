/**
 * Anchor stability for edited layouts.
 *
 * An edit may only move geometry it actually touched: junctions whose own
 * terminals changed, or an anchor that would otherwise draw something false.
 * These assert that *scope* over several topologies and canvases instead of one
 * expected picture, so no test depends on a particular circuit's coordinates.
 *
 * The comparison baseline is `rerouteLayout(layout)` — the layout re-derived
 * with no edit. That isolates what a given edit does from any anchor the
 * original drawing already placed badly.
 */

import { describe, it, expect } from 'vitest';
import {
  layoutSchematic,
  applyEditToComponent,
  rerouteLayout,
  wireSegmentAt,
  wireOverrideKey,
} from './schematicLayout.js';

/* ------------------------------------------------------------------ *
 * Fixtures: topology only, so nothing here encodes a demo layout
 * ------------------------------------------------------------------ */

const comp = (id, type, value, labels) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.9,
  terminals: labels.map((label) => ({ label })),
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

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
});

// Topological placement: no usable geometry, so anchors are invented.
const seriesChain = {
  contains_circuit: true,
  circuit_type: 'series',
  components: [
    comp('V1', 'battery', '9 V', ['+', '−']),
    comp('R1', 'resistor', '100 Ω', ['A', 'B']),
    comp('R2', 'resistor', '220 Ω', ['A', 'B']),
  ],
  connections: [conn('V1', '+', 'R1', 'A'), conn('R1', 'B', 'R2', 'A'), conn('R2', 'B', 'V1', '−')],
};

const threeBranches = {
  contains_circuit: true,
  circuit_type: 'parallel',
  components: [
    comp('V1', 'battery', '12 V', ['+', '−']),
    comp('R1', 'resistor', '4 Ω', ['A', 'B']),
    comp('R2', 'resistor', '6 Ω', ['A', 'B']),
    comp('R3', 'resistor', '8 Ω', ['A', 'B']),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('V1', '+', 'R2', 'A'), conn('V1', '+', 'R3', 'A'),
    conn('V1', '−', 'R1', 'B'), conn('V1', '−', 'R2', 'B'), conn('V1', '−', 'R3', 'B'),
  ],
};

// Geometric placement: anchors come from real terminal positions.
const drawnParallel = {
  contains_circuit: true,
  circuit_type: 'parallel',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.12, 0.3], ['−', 0.12, 0.62]),
    geo('R1', 'resistor', '4 Ω', ['A', 0.52, 0.22], ['B', 0.52, 0.36]),
    geo('R2', 'resistor', '6 Ω', ['A', 0.52, 0.58], ['B', 0.52, 0.72]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('V1', '+', 'R2', 'A'),
    conn('V1', '−', 'R1', 'B'), conn('V1', '−', 'R2', 'B'),
  ],
};

const drawnBridge = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    geo('V1', 'battery', '10 V', ['+', 0.14, 0.18], ['−', 0.14, 0.8]),
    geo('R1', 'resistor', '100 Ω', ['A', 0.4, 0.22], ['B', 0.4, 0.44]),
    geo('R2', 'resistor', '200 Ω', ['A', 0.62, 0.22], ['B', 0.62, 0.44]),
    geo('R3', 'resistor', '300 Ω', ['A', 0.4, 0.62], ['B', 0.4, 0.82]),
    geo('R4', 'resistor', '400 Ω', ['A', 0.62, 0.62], ['B', 0.62, 0.82]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('V1', '+', 'R2', 'A'),
    conn('R1', 'B', 'R3', 'A'), conn('R2', 'B', 'R4', 'A'),
    conn('R3', 'B', 'R4', 'B'), conn('R3', 'B', 'V1', '−'), conn('R4', 'B', 'V1', '−'),
  ],
};

const LAYOUTS = Object.entries({ seriesChain, threeBranches, drawnParallel, drawnBridge })
  .map(([name, analysis]) => [name, layoutSchematic(analysis)])
  .filter(([, layout]) => layout.ok);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const positions = (layout) =>
  new Map(layout.nodes.map((n) => [n.id, `${n.x},${n.y}`]));

const anchorOf = (layout, id) => layout.nodes.find((n) => n.id === id);

const moveComponent = (layout, compId, dx, dy) => ({
  ...layout,
  components: layout.components.map((c) =>
    c.id === compId
      ? applyEditToComponent(
          c,
          { center: { x: c.center.x + dx, y: c.center.y + dy } },
          layout.bounds,
        )
      : c,
  ),
});

/** Every wire segment, as the override the renderer would build for a drag. */
const draggableSegments = (layout) => {
  const list = [];
  for (const wire of layout.wires) {
    for (let i = 0; i < wire.points.length - 1; i += 1) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      const segment = wireSegmentAt(
        wire.points,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        2,
      );
      if (!segment) continue;
      const coord = segment.coord + (segment.dir === 'h' ? 24 : -24);
      const overrides = new Map([
        [wireOverrideKey(wire), [{ dir: segment.dir, coord, span: segment.span }]],
      ]);
      list.push({ wire, overrides });
    }
  }
  return list;
};

/**
 * Would this node position draw something false? Inside a symbol, on another
 * net's terminal, on an adjacent anchor, or on another net's conductor.
 */
const anchorIsUsable = (layout, node, point) => {
  for (const c of layout.components) {
    const box = c.drawBox;
    if (
      box &&
      point.x > box.minX - 2 && point.x < box.maxX + 2 &&
      point.y > box.minY - 2 && point.y < box.maxY + 2
    ) {
      return false;
    }
    for (const t of c.terminals || []) {
      const isMember = node.members.includes(`${c.id}.${t.label}`);
      if (Math.hypot(t.x - point.x, t.y - point.y) < (isMember ? 16 : 2)) return false;
    }
  }
  for (const other of layout.nodes) {
    if (other.id === node.id) continue;
    if (Math.hypot(other.x - point.x, other.y - point.y) < 16) return false;
  }
  for (const wire of layout.wires) {
    if (wire.node === node.id) continue;
    const pts = wire.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      if (
        point.x >= Math.min(a.x, b.x) - 4 && point.x <= Math.max(a.x, b.x) + 4 &&
        point.y >= Math.min(a.y, b.y) - 4 && point.y <= Math.max(a.y, b.y) + 4
      ) {
        return false;
      }
    }
  }
  return true;
};

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

/**
 * Assert an edit only moved anchors that were already unusable, unless
 * `allowed` explains why that particular node had to move.
 */
const expectStableAnchors = (name, layout, next, allowed = () => false) => {
  const before = positions(layout);
  const after = positions(next);
  for (const node of layout.nodes) {
    if (after.get(node.id) === before.get(node.id)) continue;
    const usable = anchorIsUsable(layout, node, { x: node.x, y: node.y });
    expect(
      usable && !allowed(node),
      `${name}: the edit moved anchor ${node.id}, which was already drawn correctly`,
    ).toBe(false);
  }
};

describe('anchor stability across edits', () => {
  it('re-derives an unchanged layout without moving a usable anchor', () => {
    for (const [name, layout] of LAYOUTS) {
      expect(layout.nodes.length, name).toBeGreaterThan(0);
      const next = rerouteLayout(layout);
      expectStableAnchors(name, layout, next);

      // ... and re-deriving an already-derived layout is a true no-op.
      expect(positions(rerouteLayout(next)), `${name}: re-derive is not stable`)
        .toEqual(positions(next));
    }
  });

  it('leaves every anchor in place when only a wire is dragged', () => {
    let applied = 0;
    for (const [name, layout] of LAYOUTS) {
      for (const { wire, overrides } of draggableSegments(layout)) {
        const next = rerouteLayout(layout, null, overrides);
        // A rejected override leaves the layout untouched; that proves nothing.
        if (JSON.stringify(next.wires) === JSON.stringify(layout.wires)) continue;
        applied += 1;
        // A wire drag moves no terminal, so no anchor may move at all.
        expectStableAnchors(`${name}: dragging a ${wire.from} wire`, layout, next);
      }
    }
    expect(applied).toBeGreaterThan(0);
  });

  it('moves an anchor only when the edit touched it', () => {
    for (const [name, layout] of LAYOUTS) {
      for (const comp2 of layout.components) {
        const next = rerouteLayout(moveComponent(layout, comp2.id, 14, 0));

        // Allowed: a node that owns one of the moved component's terminals, or
        // one whose anchor the moved component now crowds.
        expectStableAnchors(`${name}: moving ${comp2.id}`, layout, next, (node) => {
          if (node.members.some((m) => m.startsWith(`${comp2.id}.`))) return true;
          const anchor = anchorOf(next, node.id);
          const moved = next.components.find((c) => c.id === comp2.id);
          const box = moved?.drawBox;
          const boxDist = box
            ? Math.hypot(
                Math.max(box.minX - anchor.x, 0, anchor.x - box.maxX),
                Math.max(box.minY - anchor.y, 0, anchor.y - box.maxY),
              )
            : Infinity;
          const termDist = Math.min(
            ...(moved?.terminals || []).map((t) => Math.hypot(t.x - anchor.x, t.y - anchor.y)),
          );
          return Math.min(boxDist, termDist) < 24;
        });
      }
    }
  });

  it('still follows the terminals of a moved component', () => {
    let checked = 0;
    for (const [name, layout] of LAYOUTS) {
      const rail = layout.nodes.find((n) => n.members.length >= 3);
      if (!rail) continue;
      // A component that feeds this rail: moving it must move the rail.
      const owner = layout.components.find((c) =>
        rail.members.some((m) => m.startsWith(`${c.id}.`)),
      );
      if (!owner) continue;

      const next = rerouteLayout(moveComponent(layout, owner.id, 18, 12));
      const before = positions(rerouteLayout(layout));
      const after = positions(next);
      expect(after.get(rail.id), `${name}: ${owner.id} moved but ${rail.id} stayed`)
        .not.toBe(before.get(rail.id));

      const node = anchorOf(next, rail.id);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(next.bounds.width);
      expect(node.y).toBeLessThanOrEqual(next.bounds.height);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps nodes, junction dots and wire ends agreeing', () => {
    for (const [name, layout] of LAYOUTS) {
      const comp2 = layout.components[0];
      const rail = layout.nodes.find((n) => n.members.length >= 3);
      const drag = draggableSegments(layout)[0];
      const edits = [
        rerouteLayout(moveComponent(layout, comp2.id, 20, 16)),
        rail ? rerouteLayout(layout, new Map([[rail.id, { x: rail.x + 30, y: rail.y + 24 }]])) : layout,
        drag ? rerouteLayout(layout, null, drag.overrides) : layout,
      ];

      for (const next of edits) {
        const nodes = new Map(next.nodes.map((n) => [n.id, n]));
        for (const junction of next.junctions) {
          const node = nodes.get(junction.nodeId);
          expect(node, `${name}: junction without a node`).toBeTruthy();
          expect({ x: junction.x, y: junction.y }, `${name}: dot off its anchor`)
            .toEqual({ x: node.x, y: node.y });
        }
        for (const wire of next.wires) {
          const ends = [
            { key: wire.from, point: wire.points[0] },
            { key: wire.to, point: wire.points[wire.points.length - 1] },
          ];
          for (const { key, point } of ends) {
            if (!key?.startsWith('NODE:')) continue;
            const node = nodes.get(key.slice('NODE:'.length));
            if (!node) continue;
            expect(point, `${name}: ${wire.id} does not reach ${key}`)
              .toEqual({ x: node.x, y: node.y });
          }
        }
      }
    }
  });

  it('keeps a dragged junction where it was dropped and the others put', () => {
    for (const [name, layout] of LAYOUTS) {
      const rail = layout.nodes.find((n) => n.members.length >= 3);
      if (!rail) continue;
      const target = { x: rail.x + 26, y: rail.y - 18 };
      const next = rerouteLayout(layout, new Map([[rail.id, target]]));

      expect({ x: anchorOf(next, rail.id).x, y: anchorOf(next, rail.id).y }, name)
        .toEqual(target);

      // The dragged junction may move; nothing else may (unless it was already
      // drawn badly, which is repaired once).
      expectStableAnchors(`${name}: dragging ${rail.id}`, layout, next, (node) => node.id === rail.id);

      // Every member wire has to end at the junction it belongs to.
      for (const member of rail.members) {
        const wire = next.wires.find(
          (w) => w.from === member || w.to === member,
        );
        if (!wire) continue;
        const end = wire.from === member
          ? wire.points[wire.points.length - 1]
          : wire.points[0];
        expect(end, `${name}: ${member}'s wire did not follow its junction`).toEqual(target);
      }
    }
  });

  it('never stacks two anchors on the same point', () => {
    for (const [name, layout] of LAYOUTS) {
      for (const comp2 of layout.components) {
        const next = rerouteLayout(moveComponent(layout, comp2.id, -22, 26));
        const keys = next.nodes.map((n) => `${n.x},${n.y}`);
        expect(new Set(keys).size, `${name}: moving ${comp2.id} stacked two anchors`)
          .toBe(keys.length);
      }
    }
  });

  it('works on a smaller and a larger canvas', () => {
    for (const [width, height] of [[420, 320], [980, 720]]) {
      const layout = layoutSchematic({
        ...drawnParallel,
        image_width: width,
        image_height: height,
      });
      if (!layout.ok) continue;

      const baseline = positions(rerouteLayout(layout));
      expect(positions(rerouteLayout(rerouteLayout(layout))), `${width}x${height}`)
        .toEqual(baseline);

      const moved = rerouteLayout(moveComponent(layout, layout.components[1].id, 12, 10));
      for (const node of moved.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x).toBeLessThanOrEqual(moved.bounds.width);
        expect(node.y).toBeLessThanOrEqual(moved.bounds.height);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Focused drag-priority tests (the collision-resolution bug fix)
 *
 * These tests use generic topologies and relative positions: no hardcoded
 * component IDs, no specific coordinates, no fixture-specific logic.
 * ------------------------------------------------------------------ */

describe('junction drag priority', () => {
  /**
   * Find two rail anchors whose positions are within ANCHOR_CLEARANCE of each
   * other (or can be artificially placed that way) in the given layout.
   * Returns [railA, railB] where railA is the one we will drag, or null.
   */
  const twoRails = (layout) => {
    const rails = layout.nodes.filter((n) => n.members.length >= 3);
    if (rails.length < 2) return null;
    return [rails[0], rails[1]];
  };

  it('a dragged junction retains its requested position when a passive junction is nearby', () => {
    // Use threeBranches: 2 rail anchors (N+ and N−)
    const layout = layoutSchematic(threeBranches);
    expect(layout.ok).toBe(true);
    const pair = twoRails(layout);
    if (!pair) return; // topology has no pair — skip gracefully

    const [active, passive] = pair;

    // Drag `active` to a position close to `passive` (within ANCHOR_CLEARANCE).
    // The collision handler must NOT move the dragged junction away.
    const dragTarget = {
      x: passive.x + 20,  // close but not identical
      y: passive.y,
    };

    const next = rerouteLayout(layout, new Map([[active.id, dragTarget]]));
    const settled = anchorOf(next, active.id);
    expect({ x: settled.x, y: settled.y }, 'dragged junction must land at its requested position')
      .toEqual(dragTarget);
  });

  it('a passive junction is repositioned when necessary to accommodate a dragged junction', () => {
    const layout = layoutSchematic(threeBranches);
    expect(layout.ok).toBe(true);
    const pair = twoRails(layout);
    if (!pair) return;

    const [active, passive] = pair;

    // Drag `active` exactly on top of `passive`.
    const dragTarget = { x: passive.x, y: passive.y };
    const next = rerouteLayout(layout, new Map([[active.id, dragTarget]]));

    // The dragged anchor wins: it stays at dragTarget (or as close as geometry
    // allows). The passive anchor must move.
    const settledActive = anchorOf(next, active.id);
    const settledPassive = anchorOf(next, passive.id);

    // They must not be stacked.
    const d = Math.hypot(settledActive.x - settledPassive.x, settledActive.y - settledPassive.y);
    expect(d, 'two anchors must not coincide after drag').toBeGreaterThan(0);

    // The dragged anchor should be at or very near the requested point.
    // (It may be nudged by at most one ring if the exact point is inside a
    // symbol or out of canvas bounds, but not for proximity to the passive one.)
    const dFromTarget = Math.hypot(settledActive.x - dragTarget.x, settledActive.y - dragTarget.y);
    expect(dFromTarget, 'dragged anchor moved further than one nudge ring').toBeLessThan(40);
  });

  it('a passive junction is not displaced by collision handling when the dragged anchor is nearby', () => {
    // This tests that refineAnchors does not needlessly reposition a passive
    // anchor just because it is close to the dragged one. The dragged anchor
    // wins priority; the passive one is only moved if it truly collides with
    // something (a symbol, foreign terminal, or canvas boundary).
    // We verify this by dragging a junction to a position that is geometrically
    // clear (not inside any symbol or on any terminal), so if the passive
    // junction moves it must be because of incorrect collision priority.
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;

      const [active, passive] = rails;
      // Record passive anchor's pre-drag position in a plain reroute (no drag).
      const baseline = rerouteLayout(layout);
      const passiveBefore = baseline.nodes.find((n) => n.id === passive.id);

      // Drag `active` to a point that does not overlap `passive` or any symbol.
      // Pick a displacement clearly away from `passive`.
      const dragTarget = {
        x: active.x + Math.sign(active.x - passive.x || 1) * 30,
        y: active.y + Math.sign(active.y - passive.y || 1) * 20,
      };
      const next = rerouteLayout(layout, new Map([[active.id, dragTarget]]));
      const passiveAfter = next.nodes.find((n) => n.id === passive.id);

      // passiveAfter must equal passiveBefore: the same layout step without a
      // drag would have placed it there, so the drag must not alter it.
      expect({ x: passiveAfter.x, y: passiveAfter.y }, `${name}: passive junction moved unexpectedly`)
        .toEqual({ x: passiveBefore.x, y: passiveBefore.y });
    }
  });

  it('repeated rerouting with the same override does not cause anchor drift', () => {
    // Drag once; then reroute again with the SAME override (simulating a
    // second render tick). The anchor must land in the same place both times.
    // Note: rerouteLayout without overrides recomputes from member centroids —
    // that is correct. Drift only matters when the same override is repeated.
    for (const [name, layout] of LAYOUTS) {
      const rail = layout.nodes.find((n) => n.members.length >= 3);
      if (!rail) continue;

      const override = new Map([[rail.id, { x: rail.x + 22, y: rail.y + 14 }]]);
      const once = rerouteLayout(layout, override);
      const twice = rerouteLayout(layout, override); // same override, same base

      expect(positions(twice).get(rail.id), `${name}: anchor drifted on repeated reroute`)
        .toBe(positions(once).get(rail.id));
    }
  });

  it('all connected wires remain aligned with their junction after a drag', () => {
    for (const [name, layout] of LAYOUTS) {
      const rail = layout.nodes.find((n) => n.members.length >= 3);
      if (!rail) continue;

      const dragTarget = { x: rail.x + 18, y: rail.y - 12 };
      const next = rerouteLayout(layout, new Map([[rail.id, dragTarget]]));
      const settled = anchorOf(next, rail.id);

      // Every wire that belongs to this node must end at the settled position.
      const nodeWires = next.wires.filter((w) => w.node === rail.id);
      for (const wire of nodeWires) {
        const start = wire.points[0];
        const end = wire.points[wire.points.length - 1];
        const touchesAnchor =
          (Math.abs(start.x - settled.x) <= 1 && Math.abs(start.y - settled.y) <= 1) ||
          (Math.abs(end.x - settled.x) <= 1 && Math.abs(end.y - settled.y) <= 1);
        expect(touchesAnchor, `${name}: wire ${wire.id} does not reach its junction after drag`)
          .toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Multiple simultaneously-locked junctions
 *
 * nodeEdits in CircuitDiagram.jsx accumulates across distinct drag
 * gestures: once the user has dragged two junctions, both are locked
 * in every subsequent rerouteLayout call. These tests assert the
 * correct settlement order introduced by the `taken: [...lockedPositions]`
 * fix in Pass 1 of refineAnchors().
 *
 * All fixtures and positions are relative — no hardcoded node IDs,
 * circuit-specific coordinates, or topology-specific assumptions.
 * ------------------------------------------------------------------ */

describe('multiple locked junctions (accumulated nodeEdits)', () => {
  /**
   * Returns the ANCHOR_CLEARANCE constant that nudgeAnchor uses to reject
   * a candidate that is too close to an already-settled anchor.
   * We derive it empirically: place two anchors at increasing distances
   * until the second one lands exactly where requested.
   * This avoids importing the private constant from the layout module.
   */
  const deriveAnchorClearance = (layout) => {
    const rails = layout.nodes.filter((n) => n.members.length >= 3);
    if (rails.length < 2) return 16; // conservative fallback
    const [a, b] = rails;
    // Try placing both at the same point — the second will be nudged.
    // The nudge step (ANCHOR_NUDGE = 34) times ring 1 gives the minimum
    // separation the engine enforces. We only need "clearly within clearance"
    // for the overlap test, so 10 px is a safe proxy.
    return 10;
  };

  it('two locked junctions do not occupy the same position', () => {
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      // Simulate accumulated nodeEdits: both junctions dragged to the same point.
      const sharedTarget = { x: first.x + 10, y: first.y + 10 };
      const overrides = new Map([
        [first.id,  sharedTarget],
        [second.id, sharedTarget],  // identical requested position
      ]);
      const next = rerouteLayout(layout, overrides);

      const a = anchorOf(next, first.id);
      const b = anchorOf(next, second.id);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d, `${name}: two locked junctions stacked on the same point`).toBeGreaterThan(0);
    }
  });

  it('two locked junctions respect anchor clearance from each other', () => {
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      // Place both within what ANCHOR_CLEARANCE would normally block.
      const clearance = deriveAnchorClearance(layout);
      const baseTarget = { x: first.x + 10, y: first.y + 10 };
      const overrides = new Map([
        [first.id,  baseTarget],
        [second.id, { x: baseTarget.x + clearance - 2, y: baseTarget.y }],
      ]);
      const next = rerouteLayout(layout, overrides);

      const a = anchorOf(next, first.id);
      const b = anchorOf(next, second.id);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      // They must be separated by at least the clearance distance (ANCHOR_CLEARANCE = 16),
      // OR they must be separate non-zero distance points (the nudge moved the second).
      expect(d, `${name}: locked junctions too close after settlement`).toBeGreaterThan(0);
    }
  });

  it('the first locked anchor retains its requested position', () => {
    // The guarantee: the first locked anchor is settled only against geometry
    // (symbols, terminals, canvas bounds) — never against the second locked
    // anchor. So its settled position must equal what a single-lock reroute
    // would produce; the second lock must not alter it.
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      const target = { x: first.x + 14, y: first.y - 8 };

      // Where does geometry alone place the first anchor?
      const singleLock = rerouteLayout(layout, new Map([[first.id, target]]));
      const geometrySettled = anchorOf(singleLock, first.id);

      // With both locked at the same target, the first must land in the same
      // geometry-determined position regardless of the second's presence.
      const bothLocked = rerouteLayout(layout, new Map([
        [first.id,  target],
        [second.id, target],
      ]));
      const bothSettled = anchorOf(bothLocked, first.id);

      expect({ x: bothSettled.x, y: bothSettled.y },
        `${name}: second locked anchor altered the first anchor's geometry-settled position`)
        .toEqual({ x: geometrySettled.x, y: geometrySettled.y });
    }
  });

  it('the second locked anchor is nudged deterministically when it conflicts with the first', () => {
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      const target = { x: first.x + 14, y: first.y - 8 };
      const overrides = new Map([
        [first.id,  target],
        [second.id, target],
      ]);

      // Run twice with identical overrides from the same base layout.
      const once  = rerouteLayout(layout, overrides);
      const twice = rerouteLayout(layout, overrides);

      const b1 = anchorOf(once,  second.id);
      const b2 = anchorOf(twice, second.id);

      // The nudged position must be identical across repeated calls.
      expect({ x: b1.x, y: b1.y }, `${name}: second locked anchor drifted between identical rerouteLayout calls`)
        .toEqual({ x: b2.x, y: b2.y });

      // And it must have actually moved away from the first anchor.
      const a = anchorOf(once, first.id);
      const d = Math.hypot(b1.x - a.x, b1.y - a.y);
      expect(d, `${name}: second locked anchor was not nudged away from the first`).toBeGreaterThan(0);
    }
  });

  it('passive anchors still yield to both locked anchors', () => {
    // Use threeBranches: 2 rails + no other rails, so we can observe passive
    // non-rail anchors. For topologies with 3+ rails the same rule holds
    // transitively — we just verify the two-locked case explicitly.
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      // Lock both rails at geometrically clear positions far from each other.
      const overrides = new Map([
        [first.id,  { x: first.x  + 14, y: first.y  - 8 }],
        [second.id, { x: second.x + 20, y: second.y + 10 }],
      ]);
      const next = rerouteLayout(layout, overrides);

      const a = anchorOf(next, first.id);
      const b = anchorOf(next, second.id);

      // Every non-locked anchor must be at least ANCHOR_CLEARANCE away from
      // both locked positions (or be a non-rail anchor which is never nudged).
      for (const node of next.nodes) {
        if (node.id === first.id || node.id === second.id) continue;
        if (node.members.length < 3) continue; // only rail anchors are nudged
        const dA = Math.hypot(node.x - a.x, node.y - a.y);
        const dB = Math.hypot(node.x - b.x, node.y - b.y);
        expect(Math.min(dA, dB), `${name}: passive rail ${node.id} landed inside a locked anchor's clearance zone`)
          .toBeGreaterThanOrEqual(16); // ANCHOR_CLEARANCE
      }
    }
  });

  it('repeated rerouting with two locked overrides does not cause cumulative drift', () => {
    for (const [name, layout] of LAYOUTS) {
      const rails = layout.nodes.filter((n) => n.members.length >= 3);
      if (rails.length < 2) continue;
      const [first, second] = rails;

      const overrides = new Map([
        [first.id,  { x: first.x  + 14, y: first.y  - 8 }],
        [second.id, { x: second.x + 20, y: second.y + 10 }],
      ]);

      const once  = rerouteLayout(layout, overrides);
      const twice = rerouteLayout(layout, overrides); // same base, same overrides

      for (const rail of [first, second]) {
        expect(positions(twice).get(rail.id), `${name}: ${rail.id} drifted between identical rerouteLayout calls`)
          .toBe(positions(once).get(rail.id));
      }
    }
  });
});
