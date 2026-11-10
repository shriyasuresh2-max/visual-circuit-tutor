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
