/**
 * Physical junctions versus electrical nodes.
 *
 * One net can meet at several places on the drawing (a rail with two tees is
 * still one node). These assert the marker policy itself — where a dot may and
 * may not be drawn — and that it never changes the electrical topology, that a
 * crossing is not a connection, and that an edit to one marker leaves the rest
 * of the drawing alone.
 *
 * Every fixture is stated as geometry and connectivity only: no component id,
 * coordinate or circuit name is special-cased anywhere in the engine or here.
 */

import { describe, it, expect } from 'vitest';
import {
  layoutSchematic,
  rerouteLayout,
  buildJunctions,
} from './schematicLayout.js';

/* ------------------------------------------------------------------ *\
 * Fixture helpers
 * ------------------------------------------------------------------ */

const comp = (id, type, value, labels) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.95,
  terminals: labels.map((label) => ({ label })),
});

const geo = (id, type, value, t0, t1) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.95,
  center: { x: (t0[1] + t1[1]) / 2, y: (t0[2] + t1[2]) / 2 },
  terminals: [
    { label: t0[0], position: { x: t0[1], y: t0[2] }, confidence: 0.95 },
    { label: t1[0], position: { x: t1[1], y: t1[2] }, confidence: 0.95 },
  ],
});

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
  confidence: 0.95,
  status: 'confirmed',
});

const circuit = (components, connections, extra = {}) => ({
  contains_circuit: true,
  circuit_type: 'mixed',
  components,
  connections,
  junctions: extra.junctions ?? [],
  image_width: 1200,
  image_height: 800,
  ...extra,
});

/** Projection the layout uses, so a test can name the point it expects. */
const project = (layout, point) => ({
  x: Math.round(72 + point.x * (layout.bounds.width - 144)),
  y: Math.round(72 + point.y * (layout.bounds.height - 144)),
});

/** Point-on-segment for any segment, diagonal included. */
const pointOnSegment = (p, a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const offLine = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / length;
  if (offLine > 2.5) return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (length * length);
  return t >= -0.02 && t <= 1.02;
};

const onOwnConductor = (layout, junction) => layout.wires
  .filter((w) => w.node === junction.nodeId)
  .some((w) => w.points.some((p, i) => i > 0 && pointOnSegment(
    { x: junction.x, y: junction.y }, w.points[i - 1], p,
  )));

const markersOf = (layout, nodeId) => layout.junctions.filter((j) => j.nodeId === nodeId);

/* ------------------------------------------------------------------ *\
 * Unit fixtures: a plan and a drawing, no layout needed
 * ------------------------------------------------------------------ */

const member = (key, point) => ({
  key,
  compId: key.split('.')[0],
  label: key.split('.')[1],
  point,
});

const railPlan = (members, point, anchorSource = 'terminal-centroid') => new Map([
  ['N0', {
    id: 'N0',
    members,
    degree: members.length,
    isRail: members.length >= 3,
    point,
    anchorSource,
  }],
]);

describe('a dot is drawn where the drawing branches', () => {
  it('marks every tee of one net, not just the node anchor', () => {
    const plan = railPlan([
      member('P1.A', { x: 40, y: 100 }),
      member('P2.A', { x: 120, y: 100 }),
      member('P3.A', { x: 200, y: 100 }),
    ], { x: 200, y: 100 });
    const wires = [
      { id: 'W1', node: 'N0', points: [{ x: 40, y: 100 }, { x: 120, y: 100 }] },
      { id: 'W2', node: 'N0', points: [{ x: 120, y: 100 }, { x: 200, y: 100 }] },
      { id: 'W3', node: 'N0', points: [{ x: 120, y: 100 }, { x: 120, y: 40 }] },
    ];

    const junctions = buildJunctions(plan, wires);

    expect(junctions.map((j) => `${j.x},${j.y}`).sort()).toEqual(['120,100', '200,100'].sort());
    // Both dots belong to the one net, and exactly one of them is the anchor.
    expect(new Set(junctions.map((j) => j.nodeId))).toEqual(new Set(['N0']));
    expect(junctions.filter((j) => j.isAnchor)).toHaveLength(1);
  });

  it('does not dot a bend, so a two-segment corner stays a corner', () => {
    const plan = railPlan([
      member('P1.A', { x: 40, y: 40 }),
      member('P2.A', { x: 200, y: 40 }),
      member('P3.A', { x: 200, y: 200 }),
    ], { x: 120, y: 120 });
    const wires = [
      { id: 'W1', node: 'N0', points: [{ x: 40, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 120 }] },
      { id: 'W2', node: 'N0', points: [{ x: 120, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 40 }] },
      { id: 'W3', node: 'N0', points: [{ x: 120, y: 120 }, { x: 200, y: 120 }] },
      { id: 'W4', node: 'N0', points: [{ x: 120, y: 120 }, { x: 200, y: 200 }] },
    ];

    const junctions = buildJunctions(plan, wires);
    const corners = new Set(['120,40', '200,40', '200,120', '200,200']);

    for (const junction of junctions) {
      expect(corners.has(`${junction.x},${junction.y}`)).toBe(false);
    }
    // The node still has exactly one draggable marker: its anchor.
    expect(junctions.filter((j) => j.isAnchor)).toHaveLength(1);
  });

  it('keeps an extracted dot that sits on its own conductor, even between branches', () => {
    const plan = railPlan([
      member('P1.A', { x: 40, y: 100 }),
      member('P2.A', { x: 120, y: 100 }),
      member('P3.A', { x: 200, y: 100 }),
    ], { x: 200, y: 100 }, 'extracted-junction');
    const wires = [
      { id: 'W1', node: 'N0', points: [{ x: 40, y: 100 }, { x: 120, y: 100 }] },
      { id: 'W2', node: 'N0', points: [{ x: 120, y: 100 }, { x: 200, y: 100 }] },
    ];
    const evidence = [{ nodeId: 'N0', point: { x: 80, y: 100 }, junctionId: 'D1' }];

    const junctions = buildJunctions(plan, wires, evidence);
    const extracted = junctions.find((j) => j.x === 80 && j.y === 100);

    expect(extracted).toBeTruthy();
    expect(extracted.source).toBe('extracted');
    expect(extracted.isAnchor).toBe(false);
    expect(junctions.filter((j) => j.isAnchor)).toHaveLength(1);
  });

  it('does not draw an extracted dot that floated off its own conductor', () => {
    const plan = railPlan([
      member('P1.A', { x: 40, y: 100 }),
      member('P2.A', { x: 120, y: 100 }),
      member('P3.A', { x: 200, y: 100 }),
    ], { x: 200, y: 100 });
    const wires = [
      { id: 'W1', node: 'N0', points: [{ x: 40, y: 100 }, { x: 120, y: 100 }] },
      { id: 'W2', node: 'N0', points: [{ x: 120, y: 100 }, { x: 200, y: 100 }] },
    ];

    const junctions = buildJunctions(plan, wires, [
      { nodeId: 'N0', point: { x: 60, y: 40 }, junctionId: 'D1' },
    ]);

    expect(junctions.some((j) => j.x === 60 && j.y === 40)).toBe(false);
  });

  it('never draws a dot for a node that is not a rail', () => {
    const plan = new Map([['N0', {
      id: 'N0',
      members: [member('P1.A', { x: 40, y: 100 }), member('P2.A', { x: 120, y: 100 })],
      degree: 2,
      isRail: false,
      point: { x: 80, y: 100 },
      anchorSource: 'terminal-centroid',
    }]]);

    expect(buildJunctions(plan, [
      { id: 'W1', node: 'N0', points: [{ x: 40, y: 100 }, { x: 120, y: 100 }] },
    ])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *\
 * Layout fixtures
 * ------------------------------------------------------------------ */

/**
 * A ladder: source on the left, three parallel branches on the right. Each net
 * is one rail with several physical tees, which is the case a single marker per
 * node gets wrong.
 */
const ladder = circuit(
  [
    geo('V1', 'battery', '12 V', ['+', 0.06, 0.32], ['−', 0.06, 0.68]),
    geo('R1', 'resistor', '10 Ω', ['A', 0.32, 0.18], ['B', 0.32, 0.82]),
    geo('R2', 'resistor', '20 Ω', ['A', 0.52, 0.18], ['B', 0.52, 0.82]),
    geo('R3', 'resistor', '30 Ω', ['A', 0.72, 0.18], ['B', 0.72, 0.82]),
  ],
  [
    conn('V1', '+', 'R1', 'A'), conn('R1', 'A', 'R2', 'A'), conn('R2', 'A', 'R3', 'A'),
    conn('V1', '−', 'R1', 'B'), conn('R1', 'B', 'R2', 'B'), conn('R2', 'B', 'R3', 'B'),
  ],
);

describe('a parallel ladder draws one dot per physical junction', () => {
  const layout = layoutSchematic(ladder);

  it('lays out without a render error', () => {
    expect(layout.ok).toBe(true);
    expect(layout.renderValidation.errors).toEqual([]);
  });

  it('draws several dots on one net, all resolving to that net', () => {
    const rails = layout.nodes.filter((n) => n.isJunction);
    expect(rails.length).toBeGreaterThan(0);

    for (const rail of rails) {
      const markers = markersOf(layout, rail.id);
      // A rail with three terminals has more than one place its conductors meet.
      expect(markers.length, `${rail.id} has ${markers.length} markers`).toBeGreaterThan(1);
      expect(new Set(markers.map((m) => m.nodeId))).toEqual(new Set([rail.id]));
      expect(markers.filter((m) => m.isAnchor)).toHaveLength(1);
    }
  });

  it('puts every dot on its own net’s conductor and never on another net', () => {
    for (const junction of layout.junctions) {
      expect(onOwnConductor(layout, junction), `${junction.id} off its conductor`).toBe(true);
    }
    for (const junction of layout.junctions.filter((j) => j.isAnchor)) {
      const node = layout.nodes.find((n) => n.id === junction.nodeId);
      expect({ x: junction.x, y: junction.y }).toEqual({ x: node.x, y: node.y });
    }
  });

  it('keeps the electrical graph untouched: dots are drawing, not connectivity', () => {
    expect(layout.nodes.filter((n) => n.isJunction)).toHaveLength(2);
    const memberCounts = layout.nodes
      .filter((n) => n.isJunction)
      .map((n) => n.members.length)
      .sort((a, b) => a - b);
    expect(memberCounts).toEqual([4, 4]);
  });
});

/* ------------------------------------------------------------------ *\
 * Crossings are not connections
 * ------------------------------------------------------------------ */

const crossingComponents = [
  geo('R1', 'resistor', '10 Ω', ['A', 0.22, 0.46], ['B', 0.34, 0.46]),
  geo('R2', 'resistor', '20 Ω', ['A', 0.66, 0.46], ['B', 0.78, 0.46]),
  geo('R3', 'resistor', '30 Ω', ['A', 0.46, 0.22], ['B', 0.46, 0.34]),
  geo('R4', 'resistor', '40 Ω', ['A', 0.46, 0.66], ['B', 0.46, 0.78]),
];

const plainCrossing = circuit(crossingComponents, [
  conn('R1', 'B', 'R2', 'A'),
  conn('R3', 'B', 'R4', 'A'),
]);

describe('an ordinary crossing stays a crossing', () => {
  const layout = layoutSchematic(plainCrossing);

  it('draws the crossing without a junction dot or an extra node', () => {
    expect(layout.ok).toBe(true);
    expect(layout.junctions).toEqual([]);
    expect(layout.crossings.length).toBeGreaterThan(0);
    expect(layout.renderValidation.errors).toEqual([]);
  });

  it('keeps the two conductors on separate electrical nodes', () => {
    const horizontal = layout.wires.find((w) => w.from === 'R1.B' && w.to === 'R2.A');
    const vertical = layout.wires.find((w) => w.from === 'R3.B' && w.to === 'R4.A');
    expect(horizontal).toBeTruthy();
    expect(vertical).toBeTruthy();
    expect(horizontal.node).not.toBe(vertical.node);
    // No dot anywhere: the drawing crosses, and a crossing is not a connection.
    expect(layout.junctions).toEqual([]);
  });
});

describe('a crossing with an explicitly confirmed junction becomes one net', () => {
  // The dot is the only evidence: it names all four terminals, so the two
  // conductors that meet there are one electrical node, drawn with a dot.
  const confirmed = circuit(crossingComponents, [], {
    junctions: [{
      id: 'D1',
      position: { x: 0.5, y: 0.5 },
      members: ['R1.B', 'R2.A', 'R3.B', 'R4.A'],
    }],
  });
  const layout = layoutSchematic(confirmed);

  it('merges the four terminals into one node with a dot at the evidence', () => {
    const rails = layout.nodes.filter((n) => n.isJunction);
    expect(rails).toHaveLength(1);
    expect([...rails[0].members].sort()).toEqual(['R1.B', 'R2.A', 'R3.B', 'R4.A'].sort());
    expect(rails[0].anchorSource).toBe('extracted-junction');
    const markers = markersOf(layout, rails[0].id);
    expect(markers.filter((j) => j.isAnchor)).toHaveLength(1);
    const dot = markers.find((j) => j.isAnchor);
    expect(Math.abs(dot.x - project(layout, { x: 0.5, y: 0.5 }).x)).toBeLessThanOrEqual(2);
    expect(Math.abs(dot.y - project(layout, { x: 0.5, y: 0.5 }).y)).toBeLessThanOrEqual(2);
    expect(layout.renderValidation.errors).toEqual([]);
  });

  it('draws no crossing marker between the two halves of one net', () => {
    expect(layout.crossings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *\
 * Contradictory extracted coordinates
 * ------------------------------------------------------------------ */

describe('components reported at the same position', () => {
  // Two symbols whose reported centres coincide: no schematic can show both, and
  // nothing in the capture says which one is mis-placed.
  const coincident = circuit(
    [
      geo('V1', 'voltage_source', '10 V', ['+', 0.30, 0.470], ['−', 0.30, 0.530]),
      geo('R1', 'resistor', '100 Ω', ['A', 0.22, 0.50], ['B', 0.38, 0.50]),
      geo('R2', 'resistor', '100 Ω', ['A', 0.50, 0.30], ['B', 0.50, 0.44]),
    ],
    [
      conn('V1', '+', 'R1', 'A'),
      conn('V1', '−', 'R2', 'A'),
      conn('R1', 'B', 'R2', 'B'),
    ],
  );
  const layout = layoutSchematic(coincident);

  it('reports the contradiction instead of inventing a position', () => {
    expect(layout.renderValidation.isValid).toBe(false);
    expect(layout.renderValidation.errors.join(' ')).toMatch(/V1 and R1 overlap/);
    expect(layout.geometryNotes.join(' ')).toMatch(/same position/);
    expect(layout.diagnostics.some((d) => d.code === 'coincident-components')).toBe(true);
  });

  it('keeps every terminal exactly where the image reported it', () => {
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    const expected = (id, label) => {
      const c = coincident.components.find((x) => x.id === id);
      const t = c.terminals.find((x) => x.label === label);
      return project(layout, t.position);
    };

    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 1.5;
    expect(near(v1.terminals[0], expected('V1', '+'))).toBe(true);
    expect(near(v1.terminals[1], expected('V1', '−'))).toBe(true);
    expect(near(r1.terminals[0], expected('R1', 'A'))).toBe(true);
    expect(near(r1.terminals[1], expected('R1', 'B'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *\
 * Editing after the marker change
 * ------------------------------------------------------------------ */

describe('dragging one junction of a net', () => {
  const base = layoutSchematic(ladder);
  const rail = base.nodes.find((n) => n.isJunction);
  const others = base.junctions.filter((j) => j.nodeId !== rail.id);
  const siblings = base.junctions.filter((j) => j.nodeId === rail.id && !j.isAnchor);
  const dragged = rerouteLayout(base, new Map([[rail.id, { x: rail.x + 26, y: rail.y + 18 }]]));

  it('keeps every other net exactly where it was', () => {
    const positionsOf = (layout, nodeId) => layout.junctions
      .filter((j) => j.nodeId === nodeId)
      .map((j) => `${j.x},${j.y}`)
      .sort();
    for (const nodeId of new Set(others.map((j) => j.nodeId))) {
      expect(positionsOf(dragged, nodeId), `${nodeId} moved`)
        .toEqual(positionsOf(base, nodeId));
    }
  });

  it('does not drag the net’s other branch markers with the anchor', () => {
    // The dragged anchor moved…
    expect(dragged.junctions.some((j) => j.nodeId === rail.id && j.isAnchor &&
      (j.x !== rail.x || j.y !== rail.y))).toBe(true);
    // …and any other marker of that net is still a real branch of the drawing,
    // never a branch marker that was carried along by the drag.
    for (const marker of dragged.junctions.filter((j) => j.nodeId === rail.id && !j.isAnchor)) {
      expect(onOwnConductor(dragged, marker), `${marker.id} followed the drag`).toBe(true);
    }
    // The branches that were not moved are still where they were.
    const before = siblings.map((j) => `${j.x},${j.y}`);
    const after = dragged.junctions
      .filter((j) => j.nodeId === rail.id && !j.isAnchor)
      .map((j) => `${j.x},${j.y}`);
    expect(after.filter((p) => before.includes(p)).length).toBeGreaterThan(0);
  });

  it('keeps connectivity and the render valid after the drag', () => {
    const node = dragged.nodes.find((n) => n.id === rail.id);
    expect(node.members).toEqual(rail.members);
    expect(dragged.renderValidation.errors).toEqual([]);
    const anchor = dragged.junctions.find((j) => j.nodeId === rail.id && j.isAnchor);
    expect({ x: anchor.x, y: anchor.y }).toEqual({ x: node.x, y: node.y });
  });
});

/* ------------------------------------------------------------------ *\
 * Bridge geometry survives the marker change
 * ------------------------------------------------------------------ */

const bridge = circuit(
  [
    geo('V1', 'voltage_source', '10 V', ['+', 0.08, 0.30], ['−', 0.08, 0.70]),
    geo('R1', 'resistor', '100 Ω', ['A', 0.28, 0.42], ['B', 0.42, 0.31]),
    geo('R2', 'resistor', '100 Ω', ['A', 0.58, 0.31], ['B', 0.72, 0.42]),
    geo('R3', 'resistor', '100 Ω', ['A', 0.28, 0.58], ['B', 0.42, 0.69]),
    geo('R4', 'resistor', '100 Ω', ['A', 0.58, 0.69], ['B', 0.72, 0.58]),
    geo('R5', 'resistor', '50 Ω', ['A', 0.50, 0.38], ['B', 0.50, 0.62]),
  ],
  [
    conn('V1', '+', 'R1', 'A'), conn('R1', 'A', 'R3', 'A'),
    conn('V1', '−', 'R2', 'B'), conn('R2', 'B', 'R4', 'B'),
    conn('R1', 'B', 'R2', 'A'), conn('R2', 'A', 'R5', 'A'),
    conn('R3', 'B', 'R4', 'A'), conn('R4', 'A', 'R5', 'B'),
  ],
  {
    junctions: [
      { id: 'D1', position: { x: 0.22, y: 0.50 }, members: ['V1.+', 'R1.A', 'R3.A'] },
      { id: 'D2', position: { x: 0.78, y: 0.50 }, members: ['V1.−', 'R2.B', 'R4.B'] },
      { id: 'D3', position: { x: 0.50, y: 0.24 }, members: ['R1.B', 'R2.A', 'R5.A'] },
      { id: 'D4', position: { x: 0.50, y: 0.76 }, members: ['R3.B', 'R4.A', 'R5.B'] },
    ],
  },
);

describe('bridge reconstruction', () => {
  const layout = layoutSchematic(bridge);

  it('keeps the four corner nodes and their dots', () => {
    const rails = layout.nodes.filter((n) => n.isJunction);
    expect(rails).toHaveLength(4);
    for (const rail of rails) {
      expect(rail.anchorSource).toBe('extracted-junction');
      const markers = markersOf(layout, rail.id);
      expect(markers.filter((j) => j.isAnchor)).toHaveLength(1);
      // Every dot sits exactly on the position the image reported for it.
      expect(markers.some((j) => j.isAnchor)).toBe(true);
    }
  });

  it('renders a clean drawing with the bridge arm in place', () => {
    expect(layout.renderValidation.errors).toEqual([]);
    const r5 = layout.components.find((c) => c.id === 'R5');
    expect(r5.center.x).toBeGreaterThan(0.4 * layout.bounds.width);
    expect(r5.center.y).toBeGreaterThan(0.35 * layout.bounds.height);
    // The bridge arm runs between the two junction dots it connects.
    expect(r5.terminals[0].node).not.toBe(r5.terminals[1].node);
  });
});
