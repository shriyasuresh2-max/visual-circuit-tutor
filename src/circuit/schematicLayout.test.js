/**
 * Generality tests for the schematic layout engine.
 *
 * These assert ALGORITHM INVARIANTS over many different topologies instead of
 * asserting one expected picture per circuit. No test encodes a coordinate or a
 * special case for a particular sample circuit.
 */

import { describe, it, expect } from 'vitest';
import { layoutCircuit } from './circuitLayout.js';
import {
  layoutSchematic,
  validateSchematic,
  applyEditToComponent,
  rerouteLayout,
  interiorSegmentAt,
  wireSegmentAt,
  shiftWireSegment,
  applyWireOverrides,
  wireOverrideKey,
} from './schematicLayout.js';
import { buildGraph, sameNode } from './electricalGraph.js';
import fixtureAnalysis from '../../tests/fixtures/sample_extracted_analysis.json';

/* ------------------------------------------------------------------ *
 * Fixtures: topologies, not pictures
 * ------------------------------------------------------------------ */

const comp = (id, type, value, terminals, extra = {}) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.9,
  terminals: terminals.map((label) => ({ label })),
  ...extra,
});

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
});

const series3 = {
  contains_circuit: true,
  circuit_type: 'series',
  components: [
    comp('V1', 'battery', '9 V', ['+', '−']),
    comp('R1', 'resistor', '100 Ω', ['A', 'B']),
    comp('R2', 'resistor', '220 Ω', ['A', 'B']),
  ],
  connections: [conn('V1', '+', 'R1', 'A'), conn('R1', 'B', 'R2', 'A'), conn('R2', 'B', 'V1', '−')],
};

const parallel3 = {
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

const mixed = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    comp('V1', 'voltage_source', '12 V', ['+', '−']),
    comp('R1', 'resistor', '2 Ω', ['A', 'B']),
    comp('R2', 'resistor', '4 Ω', ['A', 'B']),
    comp('R3', 'resistor', '6 Ω', ['A', 'B']),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'),
    conn('R1', 'B', 'R2', 'A'), conn('R1', 'B', 'R3', 'A'),
    conn('R2', 'B', 'R3', 'B'),
    conn('R3', 'B', 'V1', '−'),
  ],
};

const twoSources = {
  contains_circuit: true,
  circuit_type: 'series',
  components: [
    comp('V1', 'battery', '6 V', ['+', '−']),
    comp('V2', 'battery', '6 V', ['+', '−']),
    comp('R1', 'resistor', '3 Ω', ['A', 'B']),
  ],
  connections: [conn('V1', '+', 'V2', '−'), conn('V2', '+', 'R1', 'A'), conn('R1', 'B', 'V1', '−')],
};

const bridge = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    comp('V1', 'voltage_source', '10 V', ['+', '−']),
    comp('R1', 'resistor', '100 Ω', ['A', 'B']),
    comp('R2', 'resistor', '200 Ω', ['A', 'B']),
    comp('R3', 'resistor', '300 Ω', ['A', 'B']),
    comp('R4', 'resistor', '400 Ω', ['A', 'B']),
    comp('R5', 'resistor', '50 Ω', ['A', 'B']),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('V1', '+', 'R2', 'A'),
    conn('R1', 'B', 'R3', 'A'), conn('R1', 'B', 'R5', 'A'),
    conn('R2', 'B', 'R4', 'A'), conn('R2', 'B', 'R5', 'B'),
    conn('R3', 'B', 'V1', '−'), conn('R4', 'B', 'V1', '−'),
  ],
};

// Two independent loops sharing one node (multiple branches + loop handling).
const twoLoops = {
  contains_circuit: true,
  circuit_type: 'unknown',
  components: [
    comp('V1', 'battery', '5 V', ['+', '−']),
    comp('R1', 'resistor', '1 Ω', ['A', 'B']),
    comp('R2', 'resistor', '2 Ω', ['A', 'B']),
    comp('V2', 'battery', '5 V', ['+', '−']),
    comp('R3', 'resistor', '3 Ω', ['A', 'B']),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('R1', 'B', 'R2', 'A'), conn('R2', 'B', 'V1', '−'),
    conn('R2', 'A', 'V2', '+'), conn('V2', '−', 'R3', 'A'), conn('R3', 'B', 'R2', 'B'),
  ],
};

const fourOrientations = {
  contains_circuit: true,
  circuit_type: 'series',
  image_width: 800,
  image_height: 600,
  components: [
    comp('R_H', 'resistor', '1 Ω', ['A', 'B'], { center: { x: 0.5, y: 0.15 }, orientation: 0 }),
    comp('R_V', 'resistor', '2 Ω', ['A', 'B'], { center: { x: 0.85, y: 0.5 }, orientation: 90 }),
    comp('R_V2', 'resistor', '3 Ω', ['A', 'B'], { center: { x: 0.5, y: 0.85 }, orientation: -90 }),
    comp('R_H2', 'resistor', '4 Ω', ['A', 'B'], { center: { x: 0.15, y: 0.5 }, orientation: 180 }),
  ],
  connections: [
    conn('R_H', 'B', 'R_V', 'A'), conn('R_V', 'B', 'R_V2', 'A'),
    conn('R_V2', 'B', 'R_H2', 'A'), conn('R_H2', 'B', 'R_H', 'A'),
  ],
};

// Geometry present, but the traced wire polylines are diagonal, looped and
// duplicated — exactly what the vision model tends to return.
const unreliableWires = {
  contains_circuit: true,
  circuit_type: 'series',
  image_width: 640,
  image_height: 400,
  components: [
    {
      id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      center: { x: 0.2, y: 0.5 }, orientation: 90,
      terminals: [
        { label: '+', position: { x: 0.2, y: 0.34 } },
        { label: '−', position: { x: 0.2, y: 0.66 } },
      ],
    },
    {
      id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      center: { x: 0.5, y: 0.18 }, orientation: 0,
      terminals: [
        { label: 'A', position: { x: 0.42, y: 0.18 } },
        { label: 'B', position: { x: 0.58, y: 0.18 } },
      ],
    },
    {
      id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      center: { x: 0.8, y: 0.5 }, orientation: 90,
      terminals: [
        { label: 'A', position: { x: 0.8, y: 0.34 } },
        { label: 'B', position: { x: 0.8, y: 0.66 } },
      ],
    },
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'), conn('R1', 'B', 'R2', 'A'), conn('R2', 'B', 'V1', '−'),
  ],
  wires: [
    { id: 'W1', points: [{ x: 0.2, y: 0.34 }, { x: 0.42, y: 0.18 }], from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { id: 'W2', points: [{ x: 0.58, y: 0.18 }, { x: 0.8, y: 0.34 }], from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
    { id: 'W3', points: [{ x: 0.8, y: 0.66 }, { x: 0.5, y: 0.8 }, { x: 0.2, y: 0.66 }], from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
    { id: 'W4', points: [{ x: 0.2, y: 0.66 }, { x: 0.2, y: 0.66 }], from_component: 'V1', from_terminal: '−', to_component: 'V1', to_terminal: '−' },
  ],
};

const openCircuit = {
  contains_circuit: true,
  circuit_type: 'unknown',
  components: [
    comp('V1', 'battery', '12 V', ['+', '−']),
    comp('R1', 'resistor', '4 Ω', ['A', 'B']),
    comp('R2', 'resistor', '6 Ω', ['A', 'B']),
  ],
  connections: [conn('V1', '+', 'R1', 'A'), conn('R1', 'B', 'R2', 'A')],
};

const TOPOLOGIES = {
  'series loop (3 components)': series3,
  'parallel (3 branches)': parallel3,
  'mixed series-parallel': mixed,
  'two voltage sources in series': twoSources,
  'wheatstone bridge': bridge,
  'two loops sharing a branch': twoLoops,
  'all four orientations': fourOrientations,
  'unreliable traced wire polylines': unreliableWires,
  'Gemini fixture (real extraction)': fixtureAnalysis,
  'open / incomplete circuit': openCircuit,
};

/* ------------------------------------------------------------------ *
 * Invariant helpers
 * ------------------------------------------------------------------ */

const MAX_DRAWN_SPAN = 200;
const MIN_DRAWN_SPAN = 80;

function nodeOfTerminal(layout) {
  const map = new Map();
  for (const c of layout.components) {
    for (const t of c.terminals) map.set(`${c.id}.${t.label}`, t.node);
  }
  return map;
}

function wireEndpoints(layout) {
  const out = [];
  for (const w of layout.wires) {
    out.push({ wire: w, point: w.points[0] });
    out.push({ wire: w, point: w.points[w.points.length - 1] });
  }
  return out;
}

function segmentsAreOrthogonal(points) {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Invariants that must hold for every topology
 * ------------------------------------------------------------------ */

describe('schematicLayout — invariants across arbitrary topologies', () => {
  for (const [name, analysis] of Object.entries(TOPOLOGIES)) {
    describe(name, () => {
      const layout = layoutCircuit(analysis);

      it('lays the circuit out successfully and validates cleanly', () => {
        expect(layout.ok).toBe(true);
        expect(layout.components.length).toBeGreaterThan(0);
        expect(layout.renderValidation).toBeDefined();
        expect(layout.renderValidation.errors).toEqual([]);
        expect(layout.renderValidation.isValid).toBe(true);
      });

      it('draws only orthogonal wire segments', () => {
        for (const w of layout.wires) {
          expect(w.points.length).toBeGreaterThanOrEqual(2);
          expect(segmentsAreOrthogonal(w.points)).toBe(true);
        }
      });

      it('touches every component terminal with a wire endpoint', () => {
        const terminals = [];
        for (const c of layout.components) {
          for (const t of c.terminals) terminals.push({ key: `${c.id}.${t.label}`, x: t.x, y: t.y });
        }
        const ends = wireEndpoints(layout);
        for (const t of terminals) {
          const hit = ends.some((e) => Math.hypot(e.point.x - t.x, e.point.y - t.y) <= 2);
          expect(hit, `terminal ${t.key} is not connected`).toBe(true);
        }
      });

      it('never emits a floating wire endpoint', () => {
        const terminals = [];
        for (const c of layout.components) {
          for (const t of c.terminals) terminals.push({ x: t.x, y: t.y });
        }
        for (const e of wireEndpoints(layout)) {
          const onTerminal = terminals.some((t) => Math.hypot(t.x - e.point.x, t.y - e.point.y) <= 2);
          const onAnchor = layout.nodes.some((n) => Math.hypot(n.x - e.point.x, n.y - e.point.y) <= 2);
          const openStub = String(e.wire.to).startsWith('OPEN:');
          expect(onTerminal || onAnchor || openStub, `wire ${e.wire.id} floats`).toBe(true);
        }
      });

      it('keeps every wire inside one electrical node', () => {
        const nodeOf = nodeOfTerminal(layout);
        for (const w of layout.wires) {
          const fromNode = String(w.from).startsWith('NODE:') ? w.from.slice(5) : nodeOf.get(w.from);
          const toNode = String(w.to).startsWith('NODE:') ? w.to.slice(5) : String(w.to).startsWith('OPEN:') ? w.to.slice(5) : nodeOf.get(w.to);
          expect(fromNode, `wire ${w.id} from ${w.from} must belong to node ${w.node}`).toBe(w.node);
          expect(toNode, `wire ${w.id} to ${w.to} must belong to node ${w.node}`).toBe(w.node);
        }
      });

      it('draws components as symbols, never as node-to-node spans', () => {
        for (const c of layout.components) {
          const span = Math.max(Math.abs(c.x2 - c.x1), Math.abs(c.y2 - c.y1));
          expect(span).toBeLessThanOrEqual(MAX_DRAWN_SPAN);
          expect(span).toBeGreaterThanOrEqual(MIN_DRAWN_SPAN);
          // The two terminals must lie on one axis
          expect(c.x1 === c.x2 || c.y1 === c.y2).toBe(true);
          // The symbol body always fits inside its terminals
          expect(c.symbolHalf * 2).toBeLessThanOrEqual(span);
        }
      });

      it('places a junction dot only where 3+ terminals meet', () => {
        for (const j of layout.junctions) {
          expect(j.members.length).toBeGreaterThanOrEqual(3);
          const ends = wireEndpoints(layout).filter(
            (e) => Math.hypot(e.point.x - j.x, e.point.y - j.y) <= 2,
          ).length;
          const atDot = layout.components.reduce(
            (n, c) => n + c.terminals.filter((t) => Math.hypot(t.x - j.x, t.y - j.y) <= 2).length,
            0,
          );
          // Every member of the node must visibly meet at the dot: through its
          // own wire, or because its terminal sits on the anchor.
          expect(ends, `junction ${j.id} is not where wires meet`).toBeGreaterThanOrEqual(2);
          expect(ends + atDot, `junction ${j.id} does not join its members`).toBeGreaterThanOrEqual(3);
        }
        for (const n of layout.nodes) {
          expect(n.isJunction).toBe(n.degree >= 3);
        }
      });

      it('gives every node its own anchor position', () => {
        const keys = layout.nodes.map((n) => `${n.x},${n.y}`);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('agrees with the electrical graph', () => {
        const graph = buildGraph(analysis);
        const nodeOfGraph = new Map();
        for (const c of graph.components) {
          for (const t of c.terminals) nodeOfGraph.set(`${c.id}.${t.label}`, t.node);
        }
        const nodeOfLayout = nodeOfTerminal(layout);
        for (const [key, nodeId] of nodeOfLayout) {
          expect(nodeId).toBe(nodeOfGraph.get(key));
        }
        for (const c of graph.connections) {
          if (!nodeOfGraph.has(`${c.from_component}.${c.from_terminal}`)) continue;
          expect(
            sameNode(graph, c.from_component, c.from_terminal, c.to_component, c.to_terminal),
          ).toBe(true);
        }
      });
    });
  }
});

/* ------------------------------------------------------------------ *
 * Behaviour that must not depend on the traced wire polylines
 * ------------------------------------------------------------------ */

describe('schematicLayout — image geometry handling', () => {
  it('ignores inaccurate traced wire polylines and rebuilds orthogonal wiring', () => {
    const withWires = layoutCircuit(unreliableWires);
    const withoutWires = layoutCircuit({ ...unreliableWires, wires: [] });

    expect(withWires.components.map((c) => c.center)).toEqual(
      withoutWires.components.map((c) => c.center),
    );
    expect(withWires.nodes.map((n) => [n.x, n.y])).toEqual(
      withoutWires.nodes.map((n) => [n.x, n.y]),
    );
    // The self-referential W4 must not produce a wire at all
    expect(withWires.wires.length).toBe(withoutWires.wires.length);
  });

  it('keeps components near their detected image position', () => {
    const layout = layoutCircuit(unreliableWires);
    const PAD = 72;
    const w = layout.bounds.width - 2 * PAD;
    const h = layout.bounds.height - 2 * PAD;
    for (const c of layout.components) {
      const source = unreliableWires.components.find((s) => s.id === c.id);
      const expected = { x: PAD + source.center.x * w, y: PAD + source.center.y * h };
      expect(Math.hypot(c.center.x - expected.x, c.center.y - expected.y)).toBeLessThanOrEqual(8);
    }
  });

  it('honours a reported rotation even when terminal positions are missing', () => {
    const layout = layoutCircuit(fourOrientations);
    for (const c of layout.components) {
      const source = fourOrientations.components.find((s) => s.id === c.id);
      const vertical = Math.abs(source.orientation) === 90;
      expect(c.x1 === c.x2).toBe(vertical);
      expect(c.y1 === c.y2).toBe(!vertical);
    }
  });

  it('falls back to a topological layout when the image has no geometry', () => {
    const layout = layoutCircuit(series3);
    expect(layout.hasGeometry).toBe(false);
    expect(layout.isApproximation).toBe(true);
    expect(layout.renderValidation.isValid).toBe(true);
  });

  it('marks open circuits as incomplete without drawing floating wires', () => {
    const layout = layoutCircuit(openCircuit);
    expect(layout.incomplete).toBe(true);
    expect(layout.message).toMatch(/incomplete/i);
    const ends = wireEndpoints(layout);
    for (const e of ends) {
      const onTerminal = layout.components.some((c) =>
        c.terminals.some((t) => Math.hypot(t.x - e.point.x, t.y - e.point.y) <= 2),
      );
      const onAnchor = layout.nodes.some((n) => Math.hypot(n.x - e.point.x, n.y - e.point.y) <= 2);
      const openStub = String(e.wire.to).startsWith('OPEN:');
      expect(onTerminal || onAnchor || openStub).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The validator itself must catch broken geometry
 * ------------------------------------------------------------------ */

describe('validateSchematic — catches defects the graph alone cannot see', () => {
  const base = layoutCircuit(parallel3);

  it('accepts an interior wire crossing that belongs to different nodes', () => {
    const layout = {
      ...base,
      wires: [
        ...base.wires,
        { id: 'TX1', points: [{ x: 120, y: 150 }, { x: 520, y: 150 }], from: 'OPEN:X1', to: 'OPEN:X1', node: 'NX' },
        { id: 'TX2', points: [{ x: 320, y: 80 }, { x: 320, y: 220 }], from: 'OPEN:X2', to: 'OPEN:X2', node: 'NY' },
      ],
    };
    const result = validateSchematic(layout);
    expect(result.errors.filter((e) => e.includes('middle of wire'))).toEqual([]);
  });

  it('rejects a wire endpoint that lands on the middle of another wire', () => {
    const layout = {
      ...base,
      wires: [
        ...base.wires,
        { id: 'TX1', points: [{ x: 120, y: 150 }, { x: 520, y: 150 }], from: 'OPEN:X1', to: 'OPEN:X1', node: 'NX' },
        { id: 'TX2', points: [{ x: 320, y: 80 }, { x: 320, y: 150 }], from: 'OPEN:X2', to: 'OPEN:X2', node: 'NY' },
      ],
    };
    const result = validateSchematic(layout);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('middle of wire'))).toBe(true);
  });

  it('rejects a diagonal wire segment', () => {
    const layout = {
      ...base,
      wires: [
        ...base.wires,
        { id: 'TX1', points: [{ x: 120, y: 120 }, { x: 260, y: 240 }], from: 'OPEN:X1', to: 'OPEN:X1', node: 'NX' },
      ],
    };
    const result = validateSchematic(layout);
    expect(result.errors.some((e) => e.includes('diagonal'))).toBe(true);
  });

  it('rejects a gap between a terminal and the wires', () => {
    const layout = { ...base, wires: base.wires.slice(1) };
    const result = validateSchematic(layout);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('gap') || e.includes('not touched'))).toBe(true);
  });

  it('rejects a layout whose terminals are disconnected inside one node', () => {
    // Remove one wire from a rail node so one terminal is no longer drawn
    // connected to the others in the same electrical node.
    const broken = base.wires.slice(0, -1);
    const result = validateSchematic({ ...base, wires: broken });
    expect(result.isValid).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Focused tests for the three layout fixes
 * ------------------------------------------------------------------ */

describe('rail anchor recalculation after collision resolution', () => {
  it('places the junction at the centroid of final terminal positions (parallel)', () => {
    const layout = layoutCircuit(parallel3);
    expect(layout.ok).toBe(true);

    // In a parallel circuit, both nodes have 3+ members (rail anchors).
    const junctions = layout.junctions.filter((j) => j.isRealJunction);
    expect(junctions.length).toBeGreaterThanOrEqual(1);

    for (const jct of junctions) {
      // Find all terminals belonging to this junction's node
      const members = jct.members || [];
      const termPoints = [];
      for (const c of layout.components) {
        for (const t of c.terminals) {
          const key = `${c.id}.${t.label}`;
          if (members.includes(key)) {
            termPoints.push({ x: t.x, y: t.y });
          }
        }
      }
      if (termPoints.length >= 2) {
        const cx = termPoints.reduce((s, p) => s + p.x, 0) / termPoints.length;
        const cy = termPoints.reduce((s, p) => s + p.y, 0) / termPoints.length;
        // The junction should be at (or very near) the centroid of its member terminals
        expect(Math.abs(jct.x - cx)).toBeLessThanOrEqual(2);
        expect(Math.abs(jct.y - cy)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('rail anchor wires still connect to the correct electrical node', () => {
    const layout = layoutCircuit(mixed);
    expect(layout.ok).toBe(true);
    expect(layout.renderValidation.isValid).toBe(true);
    // The mixed circuit has a 3-member node (R1.B, R2.A, R3.A) — its junction
    // must exist and all member wires must reach it.
    const railJunctions = layout.junctions.filter((j) => j.isRealJunction);
    expect(railJunctions.length).toBeGreaterThanOrEqual(1);
    // Every wire endpoint should touch a terminal or a junction (no floating)
    expect(layout.renderValidation.errors.filter((e) => e.includes('floating'))).toHaveLength(0);
  });

  it('keeps wires connected after collision resolution moves components', () => {
    // The bridge has 4 nodes, two of which are 3+ member rails.
    const layout = layoutCircuit(bridge);
    expect(layout.renderValidation.isValid).toBe(true);
    // No terminal should have a visible gap to its wire
    expect(layout.renderValidation.errors.filter((e) => e.includes('gap') || e.includes('not touched'))).toHaveLength(0);
  });
});

describe('edited layouts stay honest', () => {
  // Real geometry (normalised terminal positions), so component moves re-route
  // actual terminals instead of exercising topology mode.
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

  const moveComponent = (layout, compId, center) => ({
    ...layout,
    components: layout.components.map((c) => (
      c.id === compId ? applyEditToComponent(c, { center }) : c
    )),
  });

  const shiftComponent = (layout, compId, dx, dy) => {
    const c = layout.components.find((x) => x.id === compId);
    return moveComponent(layout, compId, { x: c.center.x + dx, y: c.center.y + dy });
  };

  const pathLengthOf = (points) => points.slice(1).reduce(
    (sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y),
    0,
  );

  const railNodes = (layout) => layout.nodes.filter((n) => n.members.length >= 3);

  it('moving a resistor creates no new foreign-wire contact', () => {
    const layout = layoutSchematic(geometricParallel);
    expect(layout.renderValidation.isValid).toBe(true);

    for (const [dx, dy] of [[0, 70], [0, -60], [-70, 0], [60, 40]]) {
      const next = rerouteLayout(shiftComponent(layout, 'R2', dx, dy));
      const touching = next.renderValidation.errors.filter(
        (e) => e.includes('middle of') || e.includes('accidental short'),
      );
      expect(touching, `move (${dx},${dy}) created ${touching.join(' | ')}`).toEqual([]);
    }
  });

  it('keeps a visible wire on every rail member after a move', () => {
    const layout = layoutSchematic(geometricParallel);
    expect(railNodes(layout).length).toBeGreaterThan(0);

    for (const [dx, dy] of [[0, 70], [0, -70], [-120, 0]]) {
      const next = rerouteLayout(shiftComponent(layout, 'R2', dx, dy));
      for (const node of railNodes(next)) {
        for (const member of node.members) {
          const wire = next.wires.find((w) => w.from === member || w.to === member);
          expect(wire, `${member} lost its wire after (${dx},${dy})`).toBeTruthy();
          expect(pathLengthOf(wire.points)).toBeGreaterThan(1);
        }
      }
    }
  });

  it('keeps every member wire when a moved terminal lands on its anchor', () => {
    const layout = layoutSchematic(geometricParallel);
    const rail = railNodes(layout)[0];
    const memberPoints = [];
    for (const c of layout.components) {
      for (const t of c.terminals) {
        if (rail.members.includes(`${c.id}.${t.label}`)) memberPoints.push({ x: t.x, y: t.y });
      }
    }
    const centroid = {
      x: memberPoints.reduce((s, p) => s + p.x, 0) / memberPoints.length,
      y: memberPoints.reduce((s, p) => s + p.y, 0) / memberPoints.length,
    };

    const r2 = layout.components.find((c) => c.id === 'R2');
    const [a] = r2.terminals;
    const next = rerouteLayout(moveComponent(layout, 'R2', {
      x: r2.center.x + (centroid.x - a.x),
      y: r2.center.y + (centroid.y - a.y),
    }));

    for (const member of rail.members) {
      const wire = next.wires.find((w) => w.from === member || w.to === member);
      expect(wire, `${member} lost its wire when its terminal reached the anchor`).toBeTruthy();
      expect(pathLengthOf(wire.points)).toBeGreaterThan(1);
    }
    expect(next.renderValidation.errors).toEqual([]);
  });

  it('validates the edited layout, not the layout it came from', () => {
    const layout = layoutSchematic(geometricParallel);
    const next = rerouteLayout(shiftComponent(layout, 'R2', 0, 70));
    expect(next.renderValidation).toEqual(validateSchematic(next));

    // Two symbols forced onto each other must be reported by the edited layout.
    const r1 = layout.components.find((c) => c.id === 'R1');
    const overlapping = moveComponent(layout, 'R2', { ...r1.center });
    const broken = rerouteLayout(overlapping);
    expect(broken.renderValidation.isValid).toBe(false);
    expect(broken.renderValidation.errors.length).toBeGreaterThan(0);

    // ... while the cached base layout keeps its own (valid) verdict.
    expect(layout.renderValidation.isValid).toBe(true);
  });

  it('gives every junction the electrical node id it draws', () => {
    const layout = layoutSchematic(geometricParallel);
    expect(layout.junctions.length).toBeGreaterThan(0);
    for (const junction of layout.junctions) {
      expect(junction.nodeId).toBeTruthy();
      expect(layout.nodes.some((n) => n.id === junction.nodeId)).toBe(true);
      // The visual id stays a junction id, never the node id.
      expect(junction.nodeId).not.toBe(junction.id);
    }
  });

  it('moves the dragged junction and the wires attached to it', () => {
    const layout = layoutSchematic(geometricParallel);
    const junction = layout.junctions[0];
    const node = layout.nodes.find((n) => n.id === junction.nodeId);
    const target = { x: junction.x + 40, y: junction.y + 20 };

    const next = rerouteLayout(layout, new Map([[node.id, target]]));
    const movedJunction = next.junctions.find((j) => j.nodeId === node.id);
    expect(movedJunction).toBeTruthy();
    expect({ x: movedJunction.x, y: movedJunction.y }).toEqual(target);
    expect(next.nodes.find((n) => n.id === node.id)).toMatchObject(target);

    for (const member of node.members) {
      const wire = next.wires.find((w) => w.from === member || w.to === member);
      expect(wire).toBeTruthy();
      expect(wire.points[wire.points.length - 1]).toEqual(target);
    }
    expect(next.renderValidation.errors).toEqual([]);
  });

  it('clamps a moved component inside the canvas', () => {
    const layout = layoutSchematic(geometricParallel);
    const next = rerouteLayout(moveComponent(layout, 'R2', { x: -5000, y: 5000 }));
    const r2 = next.components.find((c) => c.id === 'R2');

    for (const t of r2.terminals) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(next.bounds.width);
      expect(t.y).toBeLessThanOrEqual(next.bounds.height);
    }

    // The same edit is clamped immediately when bounds are supplied, and the
    // component keeps its orientation.
    const original = layout.components.find((c) => c.id === 'R2');
    const direct = applyEditToComponent(original, { center: { x: -5000, y: 5000 } }, layout.bounds);
    expect(direct.center.x).toBeGreaterThan(0);
    expect(direct.center.y).toBeLessThan(layout.bounds.height);
    expect(direct.axis).toEqual(original.axis);
    expect(direct.terminals.map((t) => t.label)).toEqual(original.terminals.map((t) => t.label));
  });

  it('never writes into the layout it was given', () => {
    const layout = layoutSchematic(geometricParallel);
    const snapshot = JSON.stringify(layout);
    const nodeId = layout.nodes[0].id;
    const wire = layout.wires[0];

    rerouteLayout(layout);
    rerouteLayout(layout, new Map([[nodeId, { x: 300, y: 200 }]]));
    rerouteLayout(layout, null, new Map([[
      wireOverrideKey(wire),
      [{ dir: wire.points[0].y === wire.points[1].y ? 'h' : 'v', coord: wire.points[0].y + 20, span: [0, 40] }],
    ]]));

    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it('keeps wire overrides working on an edited layout', () => {
    const layout = layoutSchematic(geometricParallel);
    const edited = rerouteLayout(shiftComponent(layout, 'R2', 0, 70));
    const base = rerouteLayout(shiftComponent(layout, 'R2', 0, 70));

    const wire = edited.wires.find((w) => w.points.length >= 3);
    expect(wire).toBeTruthy();
    const segment = {
      dir: wire.points[0].y === wire.points[1].y ? 'h' : 'v',
      coord: (wire.points[0].y === wire.points[1].y ? wire.points[1].y : wire.points[1].x) + 20,
      span: [
        Math.min(wire.points[0].x, wire.points[1].x),
        Math.max(wire.points[0].x, wire.points[1].x),
      ],
    };

    const next = rerouteLayout(
      shiftComponent(layout, 'R2', 0, 70),
      null,
      new Map([[wireOverrideKey(wire), [segment]]]),
    );
    const moved = next.wires.find((w) => wireOverrideKey(w) === wireOverrideKey(wire));

    expect(moved.points[0]).toEqual(wire.points[0]);
    expect(moved.points[moved.points.length - 1]).toEqual(wire.points[wire.points.length - 1]);
    expect(moved.node).toBe(wire.node);
    expect(next.wires.length).toBe(base.wires.length);
    expect(next.renderValidation).toEqual(validateSchematic(next));
  });
});

describe('label placement proximity', () => {
  it('keeps every label within a reasonable distance of its component', () => {
    for (const [name, analysis] of Object.entries(TOPOLOGIES)) {
      const layout = layoutCircuit(analysis);
      if (!layout.ok) continue;
      for (const comp of layout.components) {
        if (!comp.labelPosition) continue;
        const dx = comp.labelPosition.x - comp.center.x;
        const dy = comp.labelPosition.y - comp.center.y;
        const dist = Math.hypot(dx, dy);
        // Label should be close to its component: no more than 80px from center.
        // (symbolPerp max is ~22, card half is 27, gap is 12 → ~61 max expected)
        expect(dist).toBeLessThan(80, `${name}: label of ${comp.id} is ${dist.toFixed(0)}px from center (too far)`);
      }
    }
  });

  it('does not place a label on top of another component symbol', () => {
    for (const [name, analysis] of Object.entries(TOPOLOGIES)) {
      const layout = layoutCircuit(analysis);
      if (!layout.ok) continue;
      for (const comp of layout.components) {
        if (!comp.labelPosition || !comp.labelBox) continue;
        for (const other of layout.components) {
          if (other.id === comp.id || !other.symbolBox) continue;
          const overlap =
            comp.labelBox.minX < other.symbolBox.maxX &&
            comp.labelBox.maxX > other.symbolBox.minX &&
            comp.labelBox.minY < other.symbolBox.maxY &&
            comp.labelBox.maxY > other.symbolBox.minY;
          expect(overlap).toBe(false, `${name}: label of ${comp.id} overlaps symbol of ${other.id}`);
        }
      }
    }
  });
});

describe('symmetric collision resolution and adaptive spacing', () => {
  it('does not push any component outside the canvas bounds', () => {
    for (const [name, analysis] of Object.entries(TOPOLOGIES)) {
      const layout = layoutCircuit(analysis);
      if (!layout.ok) continue;
      const { width, height } = layout.bounds;
      for (const comp of layout.components) {
        if (!comp.symbolBox) continue;
        expect(comp.symbolBox.minX).toBeGreaterThanOrEqual(-2, `${name}: ${comp.id} minX=${comp.symbolBox.minX}`);
        expect(comp.symbolBox.maxX).toBeLessThanOrEqual(width + 2, `${name}: ${comp.id} maxX=${comp.symbolBox.maxX}`);
        expect(comp.symbolBox.minY).toBeGreaterThanOrEqual(-2, `${name}: ${comp.id} minY=${comp.symbolBox.minY}`);
        expect(comp.symbolBox.maxY).toBeLessThanOrEqual(height + 2, `${name}: ${comp.id} maxY=${comp.symbolBox.maxY}`);
      }
    }
  });

  it('separates all component symbol boxes so none overlap', () => {
    for (const [name, analysis] of Object.entries(TOPOLOGIES)) {
      const layout = layoutCircuit(analysis);
      if (!layout.ok) continue;
      const comps = layout.components.filter((c) => c.type !== 'wire' && c.symbolBox);
      for (let i = 0; i < comps.length; i++) {
        for (let j = i + 1; j < comps.length; j++) {
          const a = comps[i].symbolBox;
          const b = comps[j].symbolBox;
          const overlap = a.minX - 2 < b.maxX && b.minX - 2 < a.maxX && a.minY - 2 < b.maxY && b.minY - 2 < a.maxY;
          expect(overlap).toBe(false, `${name}: ${comps[i].id} and ${comps[j].id} overlap`);
        }
      }
    }
  });

  it('adapts node spacing to the canvas size', () => {
    // A small canvas with many nodes should still separate them.
    const manyNodes = {
      contains_circuit: true,
      circuit_type: 'mixed',
      components: [
        comp('V1', 'battery', '12 V', ['+', '−']),
        comp('R1', 'resistor', '1 Ω', ['A', 'B']),
        comp('R2', 'resistor', '2 Ω', ['A', 'B']),
        comp('R3', 'resistor', '3 Ω', ['A', 'B']),
        comp('R4', 'resistor', '4 Ω', ['A', 'B']),
        comp('R5', 'resistor', '5 Ω', ['A', 'B']),
      ],
      connections: [
        conn('V1', '+', 'R1', 'A'), conn('V1', '+', 'R2', 'A'),
        conn('R1', 'B', 'R3', 'A'), conn('R2', 'B', 'R4', 'A'),
        conn('R3', 'B', 'R5', 'A'), conn('R4', 'B', 'R5', 'B'),
        conn('R5', 'B', 'V1', '−'),
      ],
    };
    const layout = layoutCircuit(manyNodes);
    expect(layout.ok).toBe(true);
    expect(layout.renderValidation.isValid).toBe(true);
    // All nodes should have distinct positions
    const positions = layout.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(positions).size).toBe(layout.nodes.length);
  });
});

/* ------------------------------------------------------------------ *
 * Polarized glyphs survive visual edits
 *
 * Polarity is carried by the glyph rotation alone, so the initial placement
 * and every later edit must derive that rotation from the same rule. These
 * assert terminal identity is preserved, not a particular picture.
 * ------------------------------------------------------------------ */

describe('voltage source polarity survives translation and rotation', () => {
  const loop = {
    contains_circuit: true,
    circuit_type: 'series',
    components: [
      comp('V1', 'battery', '12 V', ['+', '−']),
      comp('R1', 'resistor', '4 Ω', ['A', 'B']),
      comp('R2', 'resistor', '6 Ω', ['A', 'B']),
    ],
    connections: [
      conn('V1', '+', 'R1', 'A'),
      conn('R1', 'B', 'R2', 'A'),
      conn('R2', 'B', 'V1', '−'),
    ],
  };

  // The glyph draws its "+" side on local -x, so with rotation `angle` that
  // side points along this unit vector in world space.
  const plusDirection = (c) => {
    const rad = (c.angle * Math.PI) / 180;
    return { x: -Math.cos(rad), y: -Math.sin(rad) };
  };

  // Unit vector from the component centre toward terminal identity 0.
  const toTerminalZero = (c) => {
    const dx = c.x1 - c.center.x;
    const dy = c.y1 - c.center.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  const expectSourceAtTerminalZero = (before, next) => {
    const plus = plusDirection(next);
    const t0 = toTerminalZero(next);
    expect(plus.x * t0.x + plus.y * t0.y).toBeGreaterThan(0.9);
    expect(next.terminals.map((t) => t.label)).toEqual(before.terminals.map((t) => t.label));
    expect(next.posTerminal).toBe('A');
    expect(next.nodeA).toBe(before.nodeA);
    expect(next.nodeB).toBe(before.nodeB);
  };

  it('keeps the + plate on its own terminal after a translation', () => {
    const before = layoutSchematic(loop).components.find((c) => c.id === 'V1');
    expectSourceAtTerminalZero(before, before);
    const moved = applyEditToComponent(before, {
      center: { x: before.center.x + 60, y: before.center.y - 40 },
    });
    expectSourceAtTerminalZero(before, moved);
    expect(moved.angle).toBe(before.angle);
  });

  it('keeps the + plate on its own terminal after a 90 degree axis change', () => {
    const before = layoutSchematic(loop).components.find((c) => c.id === 'V1');
    const rotated = applyEditToComponent(before, {
      axis: { x: -before.axis.y, y: before.axis.x },
    });
    expectSourceAtTerminalZero(before, rotated);
    expect(rotated.terminals.map((t) => t.label)).toEqual(['+', '−']);
  });

  it('applies the same rule when the + terminal is terminal 1', () => {
    const reversed = {
      ...loop,
      components: [
        comp('V1', 'battery', '12 V', ['−', '+']),
        comp('R1', 'resistor', '4 Ω', ['A', 'B']),
        comp('R2', 'resistor', '6 Ω', ['A', 'B']),
      ],
      connections: [
        conn('V1', '−', 'R1', 'A'),
        conn('R1', 'B', 'R2', 'A'),
        conn('R2', 'B', 'V1', '+'),
      ],
    };
    const before = layoutSchematic(reversed).components.find((c) => c.id === 'V1');
    const moved = applyEditToComponent(before, {
      center: { x: before.center.x + 30, y: before.center.y + 30 },
    });
    expect(moved.angle).toBe(before.angle);
    expect(moved.posTerminal).toBe('B');
    expect(moved.terminals.map((t) => t.label)).toEqual(['−', '+']);
    // The + side must point at terminal 1 (the '+'), never at terminal 0.
    const plus = plusDirection(moved);
    const dx = moved.x2 - moved.center.x;
    const dy = moved.y2 - moved.center.y;
    const len = Math.hypot(dx, dy) || 1;
    expect(plus.x * (dx / len) + plus.y * (dy / len)).toBeGreaterThan(0.9);
  });
});

/* ------------------------------------------------------------------ *
 * Manual wire-segment dragging
 *
 * A dragged segment is geometry only. These assert segment selection,
 * fixed endpoints, orthogonal geometry, and that node membership survives a
 * visual edit untouched.
 * ------------------------------------------------------------------ */

describe('manual wire segment editing', () => {
  // Three segments: the middle horizontal and the first vertical are interior
  // (the outer segments touch the wire's endpoints).
  const path = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 200, y: 60 }, { x: 200, y: 120 },
  ];

  const isOrthogonal = (points) => {
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a.x !== b.x && a.y !== b.y) return false;
    }
    return true;
  };

  // A layout that needs a Z route (image geometry with diagonal terminals),
  // so the draggable-segment path is exercised on real routing output.
  const geometryLoop = {
    contains_circuit: true,
    circuit_type: 'mixed',
    components: [
      { id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.9, center: { x: 0.12, y: 0.55 }, terminals: [{ label: '+', position: { x: 0.05, y: 0.45 } }, { label: '−', position: { x: 0.05, y: 0.65 } }] },
      { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9, center: { x: 0.45, y: 0.15 }, terminals: [{ label: 'A', position: { x: 0.42, y: 0.1 } }, { label: 'B', position: { x: 0.48, y: 0.2 } }] },
      { id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9, center: { x: 0.48, y: 0.55 }, terminals: [{ label: 'A', position: { x: 0.45, y: 0.5 } }, { label: 'B', position: { x: 0.51, y: 0.6 } }] },
      { id: 'R3', type: 'resistor', visible_value: '8 Ω', confidence: 0.9, center: { x: 0.3, y: 0.85 }, terminals: [{ label: 'A', position: { x: 0.27, y: 0.8 } }, { label: 'B', position: { x: 0.33, y: 0.9 } }] },
    ],
    connections: [
      conn('V1', '+', 'R1', 'A'),
      conn('V1', '+', 'R2', 'A'),
      conn('R1', 'B', 'R3', 'A'),
      conn('R2', 'B', 'R3', 'B'),
      conn('R3', 'B', 'V1', '−'),
    ],
  };

  // Find any draggable interior segment in a layout, without assuming a wire id.
  const findDraggable = (layout) => {
    for (const wire of layout.wires) {
      for (let i = 1; i <= wire.points.length - 3; i += 1) {
        const a = wire.points[i];
        const b = wire.points[i + 1];
        const segment = interiorSegmentAt(wire.points, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 10);
        if (segment) return { wire, segment };
      }
    }
    return null;
  };

  it('finds interior segments and refuses the ones attached to the endpoints', () => {
    expect(interiorSegmentAt(path, { x: 120, y: 62 }, 10)).toEqual({ index: 2, dir: 'h', coord: 60, span: [100, 200] });
    expect(interiorSegmentAt(path, { x: 103, y: 30 }, 10)).toEqual({ index: 1, dir: 'v', coord: 100, span: [0, 60] });

    // First and last segment touch the wire's endpoints: not draggable.
    expect(interiorSegmentAt(path, { x: 40, y: 0 }, 10)).toBeNull();
    expect(interiorSegmentAt(path, { x: 200, y: 100 }, 10)).toBeNull();
    // Out of grabbing distance.
    expect(interiorSegmentAt(path, { x: 120, y: 100 }, 10)).toBeNull();
    // A single straight or L-shaped run has no interior segment at all.
    expect(interiorSegmentAt([{ x: 0, y: 0 }, { x: 80, y: 0 }], { x: 40, y: 0 }, 10)).toBeNull();
    expect(interiorSegmentAt([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }], { x: 30, y: 0 }, 10)).toBeNull();
  });

  it('shifts a horizontal segment vertically, keeping both endpoints and orthogonality', () => {
    const moved = shiftWireSegment(path, 2, 90);
    expect(moved[0]).toEqual({ x: 0, y: 0 });
    expect(moved[moved.length - 1]).toEqual({ x: 200, y: 120 });
    expect(moved[2]).toEqual({ x: 100, y: 90 });
    expect(moved[3]).toEqual({ x: 200, y: 90 });
    expect(isOrthogonal(moved)).toBe(true);
  });

  it('shifts a vertical segment horizontally, keeping both endpoints and orthogonality', () => {
    const moved = shiftWireSegment(path, 1, 40);
    expect(moved[1]).toEqual({ x: 40, y: 0 });
    expect(moved[2]).toEqual({ x: 40, y: 60 });
    expect(moved[0]).toEqual({ x: 0, y: 0 });
    expect(moved[4]).toEqual({ x: 200, y: 120 });
    expect(isOrthogonal(moved)).toBe(true);
  });

  it('refuses no-ops, diagonals and collapsing neighbours on interior segments', () => {
    expect(shiftWireSegment(path, 2, 60)).toBeNull();
    expect(shiftWireSegment(path, 2, 0)).toBeNull(); // would collapse the vertical run
    expect(shiftWireSegment(path, 2, 120)).toBeNull(); // and at the far end
    expect(shiftWireSegment(path, 1, 0)).toBeNull(); // would collapse the first run
    expect(shiftWireSegment(path, 2, Number.NaN)).toBeNull();
    // Diagonals are never draggable.
    expect(shiftWireSegment([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 40, y: 30 }, { x: 40, y: 60 }], 1, 20)).toBeNull();
  });

  describe('L-shaped wires', () => {
    // A → B → C: both segments touch one of the wire's endpoints.
    const lPath = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }];

    // Diagonal terminal pairs route with exactly one bend, so this circuit's
    // wires really are L-shaped.
    const lCircuit = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'V1', type: 'battery', visible_value: '9 V', confidence: 0.9, center: { x: 0.1, y: 0.5 }, terminals: [{ label: '+', position: { x: 0.1, y: 0.4 } }, { label: '−', position: { x: 0.1, y: 0.6 } }] },
        { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9, center: { x: 0.485, y: 0.23 }, terminals: [{ label: 'A', position: { x: 0.45, y: 0.18 } }, { label: 'B', position: { x: 0.52, y: 0.28 } }] },
        { id: 'R2', type: 'resistor', visible_value: '5 Ω', confidence: 0.9, center: { x: 0.485, y: 0.75 }, terminals: [{ label: 'A', position: { x: 0.45, y: 0.8 } }, { label: 'B', position: { x: 0.52, y: 0.7 } }] },
      ],
      connections: [
        conn('V1', '+', 'R1', 'A'),
        conn('R1', 'B', 'R2', 'B'),
        conn('R2', 'A', 'V1', '−'),
      ],
    };

    const noDegenerateSegments = (points) => {
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        if (a.x === b.x && a.y === b.y) return false; // duplicate point
        if (a.x !== b.x && a.y !== b.y) return false; // diagonal segment
      }
      return true;
    };

    it('hit-tests both arms, and still calls them non-interior segments', () => {
      expect(wireSegmentAt(lPath, { x: 40, y: 2 }, 10)).toEqual({
        index: 0, dir: 'h', coord: 0, span: [0, 100], end: 'start',
      });
      expect(wireSegmentAt(lPath, { x: 102, y: 30 }, 10)).toEqual({
        index: 1, dir: 'v', coord: 100, span: [0, 60], end: 'end',
      });
      expect(wireSegmentAt(lPath, { x: 40, y: 40 }, 10)).toBeNull();
      expect(interiorSegmentAt(lPath, { x: 40, y: 2 }, 10)).toBeNull();
    });

    it('drags the horizontal arm with both endpoints fixed', () => {
      const moved = shiftWireSegment(lPath, 0, 30);
      expect(moved).toEqual([
        { x: 0, y: 0 }, { x: 0, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 60 },
      ]);
      expect(moved[0]).toEqual(lPath[0]);
      expect(moved[moved.length - 1]).toEqual(lPath[lPath.length - 1]);
      expect(isOrthogonal(moved)).toBe(true);
      expect(noDegenerateSegments(moved)).toBe(true);
    });

    it('drags the vertical arm with both endpoints fixed', () => {
      const moved = shiftWireSegment(lPath, 1, 40);
      expect(moved).toEqual([
        { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 60 }, { x: 100, y: 60 },
      ]);
      expect(moved[0]).toEqual(lPath[0]);
      expect(moved[moved.length - 1]).toEqual(lPath[lPath.length - 1]);
      expect(isOrthogonal(moved)).toBe(true);
      expect(noDegenerateSegments(moved)).toBe(true);
    });

    it('simplifies the detour when an arm lands on the far bend', () => {
      const moved = shiftWireSegment(lPath, 0, 60);
      expect(moved).toEqual([{ x: 0, y: 0 }, { x: 0, y: 60 }, { x: 100, y: 60 }]);
      expect(moved[moved.length - 1]).toEqual(lPath[lPath.length - 1]);
      expect(isOrthogonal(moved)).toBe(true);
      expect(noDegenerateSegments(moved)).toBe(true);
    });

    it('refuses no-op and malformed arm moves', () => {
      expect(shiftWireSegment(lPath, 0, 0)).toBeNull();
      expect(shiftWireSegment(lPath, 0, Number.NaN)).toBeNull();
      expect(shiftWireSegment(lPath, 0.5, 20)).toBeNull();
      expect(shiftWireSegment(lPath, 2, 20)).toBeNull(); // no such segment
      expect(shiftWireSegment([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 40, y: 10 }], 0, 20)).toBeNull();
    });

    it('applies an arm override through applyWireOverrides by wire identity', () => {
      const wire = { id: 'W1', from: 'V1.+', to: 'R1.A', node: 'N0', points: lPath.map((p) => ({ ...p })) };
      const overrides = new Map([[
        wireOverrideKey(wire),
        [{ dir: 'h', coord: 30, span: [0, 100], end: 'start' }],
      ]]);
      const [next] = applyWireOverrides([wire], overrides);
      expect(next.id).toBe('W1');
      expect(next.from).toBe('V1.+');
      expect(next.to).toBe('R1.A');
      expect(next.node).toBe('N0');
      expect(next.points).toEqual([
        { x: 0, y: 0 }, { x: 0, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 60 },
      ]);
      expect(wire.points).toEqual(lPath); // input untouched
    });

    it('drags a routed L-shaped wire without changing connectivity', () => {
      const layout = layoutSchematic(lCircuit);
      const base = rerouteLayout(layout);
      const lWire = base.wires.find((w) => w.points.length === 3);
      expect(lWire).toBeTruthy();

      const segment = wireSegmentAt(
        lWire.points,
        { x: (lWire.points[0].x + lWire.points[1].x) / 2, y: (lWire.points[0].y + lWire.points[1].y) / 2 },
        10,
      );
      expect(segment).not.toBeNull();
      const coord = segment.coord + 20;
      const overrides = new Map([[
        wireOverrideKey(lWire),
        [{ dir: segment.dir, coord, span: segment.span, end: segment.end }],
      ]]);
      const next = rerouteLayout(layout, null, overrides);

      const moved = next.wires.find((w) => wireOverrideKey(w) === wireOverrideKey(lWire));
      expect(moved.points[0]).toEqual(lWire.points[0]);
      expect(moved.points[moved.points.length - 1]).toEqual(lWire.points[lWire.points.length - 1]);
      expect(moved.from).toBe(lWire.from);
      expect(moved.to).toBe(lWire.to);
      expect(moved.node).toBe(lWire.node);
      expect(moved.points.some((p) => p.y === coord)).toBe(true);
      expect(isOrthogonal(moved.points)).toBe(true);
      expect(noDegenerateSegments(moved.points)).toBe(true);

      // No wire added or removed; node membership and terminal nodes unchanged.
      expect(next.wires.length).toBe(base.wires.length);
      expect(next.nodes.map((n) => ({ id: n.id, members: n.members })))
        .toEqual(base.nodes.map((n) => ({ id: n.id, members: n.members })));
      expect(next.components.map((c) => c.terminals.map((t) => ({ label: t.label, node: t.node }))))
        .toEqual(base.components.map((c) => c.terminals.map((t) => ({ label: t.label, node: t.node }))));
      const baseErrors = validateSchematic(base).errors;
      expect(validateSchematic(next).errors.filter((e) => !baseErrors.includes(e))).toEqual([]);
    });

    it('rejects an arm override that would introduce a validation error', () => {
      const layout = layoutSchematic(lCircuit);
      const base = rerouteLayout(layout);
      const lWire = base.wires.find((w) => w.points.length === 3);
      const segment = wireSegmentAt(
        lWire.points,
        { x: (lWire.points[0].x + lWire.points[1].x) / 2, y: (lWire.points[0].y + lWire.points[1].y) / 2 },
        10,
      );
      const overrides = new Map([[
        wireOverrideKey(lWire),
        [{ dir: segment.dir, coord: -500, span: segment.span, end: segment.end }],
      ]]);
      const next = rerouteLayout(layout, null, overrides);
      expect(next.wires.map((w) => w.points)).toEqual(base.wires.map((w) => w.points));
    });
  });

  describe('applyWireOverrides', () => {
    const wire = { id: 'W3', from: 'R1.B', to: 'R3.A', node: 'N2', points: path.map((p) => ({ ...p })) };

    it('moves the described segment without changing wire identity or endpoints', () => {
      const overrides = new Map([[wireOverrideKey(wire), [{ dir: 'h', coord: 90, span: [100, 200] }]]]);
      const [next] = applyWireOverrides([wire], overrides);
      expect(next.id).toBe('W3');
      expect(next.from).toBe('R1.B');
      expect(next.to).toBe('R3.A');
      expect(next.node).toBe('N2');
      expect(next.points[2]).toEqual({ x: 100, y: 90 });
      expect(next.points[0]).toEqual(wire.points[0]);
      expect(next.points[next.points.length - 1]).toEqual(wire.points[wire.points.length - 1]);
      expect(isOrthogonal(next.points)).toBe(true);
    });

    it('ignores an override filed under a different wire identity', () => {
      const overrides = new Map([['N9|X.A|Y.B', [{ dir: 'h', coord: 90, span: [100, 200] }]]]);
      expect(applyWireOverrides([wire], overrides)[0]).toBe(wire);
    });

    it('discards an override whose segment no longer exists', () => {
      const overrides = new Map([[wireOverrideKey(wire), [{ dir: 'v', coord: 90, span: [100, 200] }]]]);
      expect(applyWireOverrides([wire], overrides)[0]).toBe(wire);
      const gone = new Map([[wireOverrideKey(wire), [{ dir: 'h', coord: 90, span: [900, 1000] }]]]);
      expect(applyWireOverrides([wire], gone)[0]).toBe(wire);
    });
  });

  describe('rerouteLayout with wire overrides', () => {
    it('moves the segment while preserving endpoints, wire identity and electrical connectivity', () => {
      const layout = layoutSchematic(geometryLoop);
      const base = rerouteLayout(layout);
      const target = findDraggable(base);
      expect(target).not.toBeNull();

      const { wire, segment } = target;
      const coord = segment.coord + 20;
      const overrides = new Map([[wireOverrideKey(wire), [{ dir: segment.dir, coord, span: segment.span }]]]);
      const next = rerouteLayout(layout, null, overrides);

      const moved = next.wires.find((w) => wireOverrideKey(w) === wireOverrideKey(wire));
      expect(moved).toBeTruthy();
      expect(moved.points[0]).toEqual(wire.points[0]);
      expect(moved.points[moved.points.length - 1]).toEqual(wire.points[wire.points.length - 1]);
      expect(moved.from).toBe(wire.from);
      expect(moved.to).toBe(wire.to);
      expect(moved.node).toBe(wire.node);

      // No wire was added or removed, and node membership is untouched.
      expect(next.wires.length).toBe(base.wires.length);
      expect(next.nodes.map((n) => ({ id: n.id, members: n.members })))
        .toEqual(base.nodes.map((n) => ({ id: n.id, members: n.members })));
      expect(next.components.map((c) => c.terminals.map((t) => t.node)))
        .toEqual(base.components.map((c) => c.terminals.map((t) => t.node)));

      // The segment really moved, and every segment is still axis-aligned.
      const coords = [];
      for (let i = 1; i <= moved.points.length - 3; i += 1) {
        const a = moved.points[i];
        const b = moved.points[i + 1];
        if (segment.dir === 'h' && a.y === b.y) coords.push(a.y);
        if (segment.dir === 'v' && a.x === b.x) coords.push(a.x);
      }
      expect(coords).toContain(coord);
      expect(isOrthogonal(moved.points)).toBe(true);

      // No new validation error was introduced.
      const baseErrors = validateSchematic(base).errors;
      expect(validateSchematic(next).errors.filter((e) => !baseErrors.includes(e))).toEqual([]);
    });

    it('rejects an override that would introduce a new validation error', () => {
      const layout = layoutSchematic(geometryLoop);
      const base = rerouteLayout(layout);
      const { wire, segment } = findDraggable(base);

      // Far outside the drawing canvas: validation must reject the move.
      const overrides = new Map([[wireOverrideKey(wire), [{ dir: segment.dir, coord: -500, span: segment.span }]]]);
      const next = rerouteLayout(layout, null, overrides);

      expect(next.wires.map((w) => w.points)).toEqual(base.wires.map((w) => w.points));
    });

    it('leaves routing untouched when no segment matches the override', () => {
      const layout = layoutSchematic(geometryLoop);
      const base = rerouteLayout(layout);
      const { wire, segment } = findDraggable(base);
      const overrides = new Map([[
        wireOverrideKey(wire),
        [{ dir: segment.dir, coord: segment.coord + 40, span: [segment.span[1] + 500, segment.span[1] + 600] }],
      ]]);
      const next = rerouteLayout(layout, null, overrides);

      expect(next.wires.map((w) => w.points)).toEqual(base.wires.map((w) => w.points));
      expect(next.nodes.map((n) => ({ id: n.id, members: n.members })))
        .toEqual(base.nodes.map((n) => ({ id: n.id, members: n.members })));
    });
  });
});
