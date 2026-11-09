import { describe, it, expect } from 'vitest';
import { layoutCircuit, describeTopology, validateRenderedCircuit } from './circuitLayout.js';
import { buildGraph, computeNodes, findCycle, sameNode } from './electricalGraph.js';
import fixtureAnalysis from '../../tests/fixtures/sample_extracted_analysis.json';

describe('Reconstruction Engine — End-to-End Image Extraction Fixture', () => {
  it('correctly reconstructs from real Gemini extraction of sample_series_circuit.png', () => {
    const layout = layoutCircuit(fixtureAnalysis);

    // Pipeline status
    expect(layout.ok).toBe(true);
    expect(layout.hasGeometry).toBe(true);
    expect(layout.isApproximation).toBe(false);
    expect(layout.incomplete).toBe(false);

    // Component preservation: V1 (12 V battery) and R1 (4 Ω resistor)
    expect(layout.components).toHaveLength(2);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    expect(v1).toBeDefined();
    expect(r1).toBeDefined();

    expect(v1.type).toBe('battery');
    expect(v1.value).toBe('12 V');
    expect(v1.orientation).toBe(90);
    // Vertical battery: x1 equals x2, y1 differs from y2
    expect(v1.x1).toBe(v1.x2);
    expect(v1.y1).not.toBe(v1.y2);
    expect(v1.posTerminal).toBe('A'); // + terminal is at top

    expect(r1.type).toBe('resistor');
    expect(r1.value).toBe('4 Ω');
    expect(r1.orientation).toBe(0);
    // Horizontal resistor: y1 equals y2, x1 differs from x2
    expect(r1.y1).toBe(r1.y2);
    expect(r1.x1).not.toBe(r1.x2);

    // The fixture declares 2 electrical nodes (N0/N1), each joining exactly two
    // terminals, so the drawing needs exactly 2 graph-derived wire edges. The
    // three Gemini-traced polylines (one of them self-referential) are replaced.
    expect(layout.wires).toHaveLength(2);
    for (const w of layout.wires) {
      expect(w.points).toBeDefined();
      expect(w.points.length).toBeGreaterThanOrEqual(2);
      for (const p of w.points) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThanOrEqual(layout.bounds.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThanOrEqual(layout.bounds.height);
      }
    }

    // Electrical connectivity: 2 nodes forming a single closed series loop
    expect(layout.nodes).toHaveLength(2);
    expect(v1.nodeA).toBe(r1.nodeA); // V1.+ connects to R1.A
    expect(r1.nodeB).toBe(v1.nodeB); // R1.B connects to V1.-

    // Distinction: 2-terminal series connections are NOT junction dots
    const n0 = layout.nodes.find((n) => n.id === v1.nodeA);
    const n1 = layout.nodes.find((n) => n.id === v1.nodeB);
    expect(n0.isJunction).toBe(false);
    expect(n1.isJunction).toBe(false);

    // Render validation
    expect(layout.renderValidation).toBeDefined();
    expect(layout.renderValidation.isValid).toBe(true);
    expect(layout.renderValidation.errors).toHaveLength(0);
  });
});

describe('Reconstruction Engine — Comprehensive Topology Suite', () => {
  // 1. Simple Series Circuit
  it('correctly reconstructs a 3-component series circuit with zero terminal gaps', () => {
    const SERIES_3 = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'V1', type: 'battery', visible_value: '9 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '100 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '220 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
        { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const layout = layoutCircuit(SERIES_3);
    expect(layout.ok).toBe(true);
    expect(layout.components).toHaveLength(3);
    expect(layout.nodes).toHaveLength(3);

    // Verify all terminals have defined coordinates
    for (const c of layout.components) {
      expect(c.x1).toBeDefined();
      expect(c.y1).toBeDefined();
      expect(c.x2).toBeDefined();
      expect(c.y2).toBeDefined();
      expect(c.terminals).toHaveLength(2);
    }

    // Series loop has 0 true junction dots
    expect(layout.junctions.filter((j) => j.isJunction)).toHaveLength(0);
    expect(layout.nodes.filter((n) => n.isJunction)).toHaveLength(0);
  });

  // 2. Simple Parallel Circuit
  it('separates parallel branches without overlap in fallback mode', () => {
    const PARALLEL_FIXTURE = {
      contains_circuit: true,
      circuit_type: 'parallel',
      components: [
        { id: 'V1', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '4 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '6 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R1', to_terminal: 'B' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R2', to_terminal: 'B' },
      ],
    };

    const layout = layoutCircuit(PARALLEL_FIXTURE);
    expect(layout.ok).toBe(true);
    expect(layout.isApproximation).toBe(true);

    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');

    // Parallel components must NOT be positioned at identical Y coordinates
    const centersY = [v1.center.y, r1.center.y, r2.center.y];
    const uniqueCentersY = new Set(centersY);
    expect(uniqueCentersY.size).toBe(3);

    // Fallback bus wires must connect branches to nodes
    expect(layout.wires.length).toBeGreaterThan(0);

    // Exactly 2 electrical nodes
    expect(layout.nodes).toHaveLength(2);
    // Both nodes have 3 members, so they are true junctions
    expect(layout.nodes.filter((n) => n.isJunction)).toHaveLength(2);
  });

  // 3. Mixed Series-Parallel Circuit
  it('correctly reconstructs a mixed series-parallel circuit', () => {
    const MIXED = {
      contains_circuit: true,
      circuit_type: 'mixed',
      components: [
        { id: 'V1', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '10 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '20 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R3', type: 'resistor', visible_value: '30 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R3', to_terminal: 'A' },
        { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
        { from_component: 'R3', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const layout = layoutCircuit(MIXED);
    expect(layout.ok).toBe(true);
    expect(layout.components).toHaveLength(4);

    const r2 = layout.components.find((c) => c.id === 'R2');
    const r3 = layout.components.find((c) => c.id === 'R3');
    // R2 and R3 share the same nodes (parallel pair)
    expect(r2.nodeA).toBe(r3.nodeA);
    expect(r2.nodeB).toBe(r3.nodeB);

    // Parallel pair must not be placed at identical positions
    expect(`${r2.x1},${r2.y1}`).not.toBe(`${r3.x1},${r3.y1}`);
  });

  // 4. Multiple Branches (4 parallel branches)
  it('handles circuits with 4 parallel branches with distinct spacing', () => {
    const FOUR_BRANCHES = {
      contains_circuit: true,
      circuit_type: 'parallel',
      components: [
        { id: 'V1', type: 'battery', visible_value: '24 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '1 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '2 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R3', type: 'resistor', visible_value: '3 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '+', to_component: 'R3', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R1', to_terminal: 'B' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R2', to_terminal: 'B' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R3', to_terminal: 'B' },
      ],
    };

    const layout = layoutCircuit(FOUR_BRANCHES);
    expect(layout.ok).toBe(true);
    const centers = layout.components.map((c) => `${c.center.x},${c.center.y}`);
    expect(new Set(centers).size).toBe(4);
  });

  // 5. Rotated Component Orientations (0, 90, -90, 180)
  it('correctly sets terminal coordinates and stubs across different component orientations', () => {
    const ORIENTATIONS = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'R_HORIZ', type: 'resistor', center: { x: 0.5, y: 0.2 }, orientation: 0,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R_VERT', type: 'resistor', center: { x: 0.8, y: 0.5 }, orientation: 90,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R_INV_VERT', type: 'resistor', center: { x: 0.2, y: 0.5 }, orientation: -90,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R_INV_HORIZ', type: 'resistor', center: { x: 0.5, y: 0.8 }, orientation: 180,
          terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'R_HORIZ', from_terminal: 'B', to_component: 'R_VERT', to_terminal: 'A' },
        { from_component: 'R_VERT', from_terminal: 'B', to_component: 'R_INV_HORIZ', to_terminal: 'A' },
        { from_component: 'R_INV_HORIZ', from_terminal: 'B', to_component: 'R_INV_VERT', to_terminal: 'A' },
        { from_component: 'R_INV_VERT', from_terminal: 'B', to_component: 'R_HORIZ', to_terminal: 'A' },
      ],
    };

    const layout = layoutCircuit(ORIENTATIONS);
    expect(layout.ok).toBe(true);

    const rH = layout.components.find((c) => c.id === 'R_HORIZ');
    const rV = layout.components.find((c) => c.id === 'R_VERT');
    const rIV = layout.components.find((c) => c.id === 'R_INV_VERT');
    const rIH = layout.components.find((c) => c.id === 'R_INV_HORIZ');

    // Horizontal: y1 == y2, x1 != x2
    expect(rH.y1).toBe(rH.y2);
    expect(rH.x1).not.toBe(rH.x2);

    // Vertical: x1 == x2, y1 != y2
    expect(rV.x1).toBe(rV.x2);
    expect(rV.y1).not.toBe(rV.y2);

    // Inverted vertical: x1 == x2, y1 != y2
    expect(rIV.x1).toBe(rIV.x2);
    expect(rIV.y1).not.toBe(rIV.y2);

    // Inverted horizontal: y1 == y2, x1 != x2
    expect(rIH.y1).toBe(rIH.y2);
    expect(rIH.x1).not.toBe(rIH.x2);
  });

  // 6. Circuits with Junctions and Wire Crossings
  it('distinguishes real 3+ junctions from disconnected wire crossings', () => {
    const CROSSING_CIRCUIT = {
      contains_circuit: true,
      circuit_type: 'mixed',
      components: [
        { id: 'V1', type: 'voltage_source', visible_value: '10 V', center: { x: 0.15, y: 0.5 }, orientation: 90,
          terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '10 Ω', center: { x: 0.5, y: 0.2 }, orientation: 0,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '20 Ω', center: { x: 0.5, y: 0.8 }, orientation: 0,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R3', type: 'resistor', visible_value: '30 Ω', center: { x: 0.5, y: 0.5 }, orientation: 90,
          terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'B' },
        { from_component: 'R2', from_terminal: 'A', to_component: 'V1', to_terminal: '−' },
        { from_component: 'V1', from_terminal: '+', to_component: 'R3', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '−', to_component: 'R3', to_terminal: 'B' },
      ],
      wires: [
        // Horizontal wire crossing a vertical wire
        { id: 'W_H', points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], is_crossing: true, confidence: 0.9 },
        { id: 'W_V', points: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }], is_crossing: false, confidence: 0.9 },
      ],
    };

    const layout = layoutCircuit(CROSSING_CIRCUIT);
    expect(layout.ok).toBe(true);

    // A declared crossing must never create a junction dot: junction dots are
    // reserved for nodes where 3+ terminals actually meet.
    for (const j of layout.junctions) {
      expect(j.members.length).toBeGreaterThanOrEqual(3);
    }
    for (const n of layout.nodes) {
      expect(n.isJunction).toBe(n.degree >= 3);
    }

    // Crossings do NOT merge the two electrical nodes
    const graph = buildGraph(CROSSING_CIRCUIT);
    expect(sameNode(graph, 'R1', 'A', 'R2', 'A')).toBe(false);
  });

  // 7. Wheatstone Bridge Circuit
  it('handles bridge circuit (Wheatstone bridge) topology faithfully', () => {
    const BRIDGE_FIXTURE = {
      contains_circuit: true,
      circuit_type: 'mixed',
      components: [
        { id: 'V1', type: 'voltage_source', visible_value: '10 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '100 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R2', type: 'resistor', visible_value: '200 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R3', type: 'resistor', visible_value: '300 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R4', type: 'resistor', visible_value: '400 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'R5', type: 'resistor', visible_value: '50 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R3', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'R5', to_terminal: 'A' },
        { from_component: 'R2', from_terminal: 'B', to_component: 'R4', to_terminal: 'A' },
        { from_component: 'R2', from_terminal: 'B', to_component: 'R5', to_terminal: 'B' },
        { from_component: 'R3', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
        { from_component: 'R4', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const graph = buildGraph(BRIDGE_FIXTURE);
    expect(graph.validation.isValid).toBe(true);
    expect(graph.nodes).toHaveLength(4); // Top, Bottom, Left, Right

    // Top node: V1.+, R1.A, R2.A
    expect(sameNode(graph, 'V1', '+', 'R1', 'A')).toBe(true);
    expect(sameNode(graph, 'V1', '+', 'R2', 'A')).toBe(true);

    // Left node: R1.B, R3.A, R5.A
    expect(sameNode(graph, 'R1', 'B', 'R5', 'A')).toBe(true);

    // Right node: R2.B, R4.A, R5.B
    expect(sameNode(graph, 'R2', 'B', 'R5', 'B')).toBe(true);

    // Bridge resistor R5 connects left and right, but does NOT short them
    expect(sameNode(graph, 'R5', 'A', 'R5', 'B')).toBe(false);

    // Multi-loop detection
    const topology = describeTopology(BRIDGE_FIXTURE);
    expect(topology.hasLoop).toBe(true);
    expect(topology.nodeCount).toBe(4);
  });

  // 8. Regression Test: No disconnected component terminals
  it('REGRESSION: no component terminal is left disconnected when electrical graph says connected', () => {
    const TEST_CIRCUIT = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'V1', type: 'battery', visible_value: '5 V', center: { x: 0.25, y: 0.5 }, orientation: 90,
          terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '10 Ω', center: { x: 0.75, y: 0.5 }, orientation: 90,
          terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const layout = layoutCircuit(TEST_CIRCUIT);
    expect(layout.ok).toBe(true);

    const allWires = layout.allWires || layout.wires;
    expect(allWires.length).toBeGreaterThanOrEqual(2);

    // For every component terminal, verify at least one wire touches its exact coordinates
    for (const c of layout.components) {
      for (const t of c.terminals) {
        const touches = allWires.some((w) =>
          w.points && w.points.some((p) => Math.hypot(p.x - t.x, p.y - t.y) <= 2)
        );
        expect(touches).toBe(true);
      }
    }
  });

  // 9. Regression Test: Component labels do not overlap symbols or terminals
  it('REGRESSION: component labels do not overlap their component symbols or terminals', () => {
    const CIRCUIT = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'R1', type: 'resistor', visible_value: '4 Ω', center: { x: 0.5, y: 0.3 }, orientation: 0,
          terminals: [{ label: 'A' }, { label: 'B' }] },
        { id: 'V1', type: 'battery', visible_value: '12 V', center: { x: 0.5, y: 0.7 }, orientation: 90,
          terminals: [{ label: '+' }, { label: '−' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const layout = layoutCircuit(CIRCUIT);
    expect(layout.ok).toBe(true);

    for (const c of layout.components) {
      expect(c.labelPosition).toBeDefined();
      const lx = c.labelPosition.x;
      const ly = c.labelPosition.y;
      const mx = c.center.x;
      const my = c.center.y;

      // Distance from center to label must be at least 30px (well clear of symbol envelope)
      const dist = Math.hypot(lx - mx, ly - my);
      expect(dist).toBeGreaterThanOrEqual(30);

      // Label rect (width 54, height 30) must not encompass the center
      const inX = Math.abs(lx - mx) < 20;
      const inY = Math.abs(ly - my) < 10;
      expect(inX && inY).toBe(false);
    }
  });

  // 10. Validation Engine: validateRenderedCircuit
  it('VALIDATION: validateRenderedCircuit confirms rendered circuit agrees with electrical graph', () => {
    const VALID_CIRCUIT = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'V1', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '−' }] },
        { id: 'R1', type: 'resistor', visible_value: '6 Ω', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
      ],
    };

    const graph = buildGraph(VALID_CIRCUIT);
    const layout = layoutCircuit(VALID_CIRCUIT);
    const validation = validateRenderedCircuit(layout, graph);

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
    expect(validation.checks.length).toBeGreaterThan(0);
  });
});
