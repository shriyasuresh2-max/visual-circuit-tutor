/**
 * Generality tests for the schematic layout engine.
 *
 * These assert ALGORITHM INVARIANTS over many different topologies instead of
 * asserting one expected picture per circuit. No test encodes a coordinate or a
 * special case for a particular sample circuit.
 */

import { describe, it, expect } from 'vitest';
import { layoutCircuit } from './circuitLayout.js';
import { layoutSchematic, validateSchematic, applyEditToComponent } from './schematicLayout.js';
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
