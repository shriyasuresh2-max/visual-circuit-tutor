import { describe, it, expect } from 'vitest';
import { computeNodes, findCycle, layoutCircuit } from './circuitLayout.js';
import { buildGraph, sameNode } from './electricalGraph.js';

/* ------------------------------------------------------------------ *
 * Mock analysis responses (mirroring the backend CircuitAnalysis schema)
 * ------------------------------------------------------------------ */

// Series loop: 12 V source -> R1 (4Ω) -> R2 (6Ω) -> back to source
//   V1.+ -- R1.A ;  R1.B -- R2.A ;  R2.B -- V1.-
const SERIES_ANALYSIS = {
  contains_circuit: true,
  is_circuit: true,
  circuit_type: 'series',
  components: [
    {
      id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      terminals: [{ label: '+' }, { label: '−' }],
    },
    {
      id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
    {
      id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
  unclear_details: [],
};

// Parallel: 12 V source with R1 (4Ω) and R2 (6Ω) in parallel
//   V1.+ -- R1.A -- R2.A ;  V1.- -- R1.B -- R2.B
const PARALLEL_ANALYSIS = {
  contains_circuit: true,
  is_circuit: true,
  circuit_type: 'parallel',
  components: [
    {
      id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      terminals: [{ label: '+' }, { label: '−' }],
    },
    {
      id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
    {
      id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R1', to_terminal: 'B' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R2', to_terminal: 'B' },
  ],
  unclear_details: [],
};

// Mixed: source with R1 in series, then R2 || R3
//   V1.+ -- R1.A ; R1.B -- R2.A -- R3.A ; R2.B -- R3.B -- V1.-
const MIXED_ANALYSIS = {
  contains_circuit: true,
  is_circuit: true,
  circuit_type: 'mixed',
  components: [
    {
      id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      terminals: [{ label: '+' }, { label: '−' }],
    },
    {
      id: 'R1', type: 'resistor', visible_value: '2 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
    {
      id: 'R2', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
    {
      id: 'R3', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R3', to_terminal: 'A' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'R3', to_terminal: 'B' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
  unclear_details: [],
};

// Uncertain connection (crossing vs junction)
const UNCERTAIN_ANALYSIS = {
  contains_circuit: true,
  is_circuit: true,
  circuit_type: 'unknown',
  components: [
    {
      id: 'V1', type: 'battery', visible_value: '9 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }],
    },
    {
      id: 'R1', type: 'resistor', visible_value: '3 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }],
    },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    {
      from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−',
      notes: 'possible crossing, junction uncertain',
    },
  ],
  unclear_details: ['Wire crossing near R1 may or may not be a junction'],
};

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('computeNodes — electrical node extraction', () => {
  it('groups connected terminals into the same node (series)', () => {
    const { nodeOf, nodes } = computeNodes(SERIES_ANALYSIS.components, SERIES_ANALYSIS.connections);
    // Series loop: 3 components, 3 connections → 3 nodes
    expect(nodes).toHaveLength(3);
    // V1.+ and R1.A must be the same node
    expect(nodeOf.get('V1.+')).toBe(nodeOf.get('R1.A'));
    // R1.B and R2.A must be the same node
    expect(nodeOf.get('R1.B')).toBe(nodeOf.get('R2.A'));
    // R2.B and V1.- must be the same node
    expect(nodeOf.get('R2.B')).toBe(nodeOf.get('V1.−'));
    // The three nodes must be distinct
    const n1 = nodeOf.get('V1.+');
    const n2 = nodeOf.get('R1.B');
    const n3 = nodeOf.get('V1.−');
    expect(n1).not.toBe(n2);
    expect(n2).not.toBe(n3);
    expect(n1).not.toBe(n3);
  });

  it('groups parallel branches into exactly 2 nodes', () => {
    const { nodeOf, nodes } = computeNodes(PARALLEL_ANALYSIS.components, PARALLEL_ANALYSIS.connections);
    expect(nodes).toHaveLength(2);
    // All "+" terminals share one node, all "−" terminals share another
    expect(nodeOf.get('V1.+')).toBe(nodeOf.get('R1.A'));
    expect(nodeOf.get('V1.+')).toBe(nodeOf.get('R2.A'));
    expect(nodeOf.get('V1.−')).toBe(nodeOf.get('R1.B'));
    expect(nodeOf.get('V1.−')).toBe(nodeOf.get('R2.B'));
    expect(nodeOf.get('V1.+')).not.toBe(nodeOf.get('V1.−'));
  });

  it('handles mixed series-parallel topology', () => {
    const { nodeOf, nodes } = computeNodes(MIXED_ANALYSIS.components, MIXED_ANALYSIS.connections);
    // R1.B, R2.A, R3.A share a node (parallel branch top)
    expect(nodeOf.get('R1.B')).toBe(nodeOf.get('R2.A'));
    expect(nodeOf.get('R1.B')).toBe(nodeOf.get('R3.A'));
    // R2.B, R3.B, V1.- share a node (parallel branch bottom)
    expect(nodeOf.get('R2.B')).toBe(nodeOf.get('R3.B'));
    expect(nodeOf.get('R2.B')).toBe(nodeOf.get('V1.−'));
  });
});

describe('findCycle — loop detection', () => {
  it('finds a cycle through the series loop', () => {
    const { nodeOf } = computeNodes(SERIES_ANALYSIS.components, SERIES_ANALYSIS.connections);
    const cycle = findCycle(SERIES_ANALYSIS.components, nodeOf);
    expect(cycle).not.toBeNull();
    expect(cycle.length).toBe(3); // triangle of 3 nodes
  });

  it('detects a cycle in the parallel circuit (2-node multigraph)', () => {
    const { nodeOf } = computeNodes(PARALLEL_ANALYSIS.components, PARALLEL_ANALYSIS.connections);
    const cycle = findCycle(PARALLEL_ANALYSIS.components, nodeOf);
    // Parallel has 2 nodes with multiple edges; a cycle requires 2+ distinct nodes
    expect(cycle).not.toBeNull();
  });
});

describe('layoutCircuit — positioning and topology preservation', () => {
  it('produces positioned components with correct node assignments (series)', () => {
    const layout = layoutCircuit(SERIES_ANALYSIS);
    expect(layout.ok).toBe(true);
    expect(layout.components).toHaveLength(3);
    // Each component must reference its two node ids
    const v1 = layout.components.find((c) => c.id === 'V1');
    expect(v1).toBeDefined();
    expect(v1.nodeA).not.toBeNull();
    expect(v1.nodeB).not.toBeNull();
    expect(v1.nodeA).not.toBe(v1.nodeB);
    // Polarity: V1.+ is terminal A; posTerminal should be 'A'
    expect(v1.posTerminal).toBe('A');
    // Values preserved
    expect(v1.value).toBe('12 V');
    const r1 = layout.components.find((c) => c.id === 'R1');
    expect(r1.value).toBe('4 Ω');
  });

  it('preserves node connectivity across the full loop (series)', () => {
    const layout = layoutCircuit(SERIES_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');
    // V1.A connects to R1.A (same node)
    expect(v1.nodeA).toBe(r1.nodeA);
    // R1.B connects to R2.A (same node)
    expect(r1.nodeB).toBe(r2.nodeA);
    // R2.B connects to V1.B (same node) — closes the loop
    expect(r2.nodeB).toBe(v1.nodeB);
  });

  it('preserves parallel branch connectivity', () => {
    const layout = layoutCircuit(PARALLEL_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');
    // Both resistors bridge the same two nodes as the source
    expect(r1.nodeA).toBe(v1.nodeA);
    expect(r1.nodeB).toBe(v1.nodeB);
    expect(r2.nodeA).toBe(v1.nodeA);
    expect(r2.nodeB).toBe(v1.nodeB);
    // Only 2 distinct nodes
    const nodeIds = new Set(layout.nodes.map((n) => n.id));
    expect(nodeIds.size).toBe(2);
  });

  it('preserves mixed series-parallel connectivity', () => {
    const layout = layoutCircuit(MIXED_ANALYSIS);
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');
    const r3 = layout.components.find((c) => c.id === 'R3');
    // R2 and R3 are in parallel (share both nodes)
    expect(r2.nodeA).toBe(r3.nodeA);
    expect(r2.nodeB).toBe(r3.nodeB);
    // R1 is in series before the parallel pair (R1.B node = R2.A node)
    expect(r1.nodeB).toBe(r2.nodeA);
    // R1.A node must NOT equal R1.B node (R1 spans two distinct nodes)
    expect(r1.nodeA).not.toBe(r1.nodeB);
  });

  it('returns ok=false when no components are detected', () => {
    const layout = layoutCircuit({ components: [], connections: [] });
    expect(layout.ok).toBe(false);
    expect(layout.message).toBeTruthy();
  });

  it('preserves uncertainty notes for ambiguous connections', () => {
    const layout = layoutCircuit(UNCERTAIN_ANALYSIS);
    expect(layout.uncertain.length).toBeGreaterThan(0);
    expect(layout.uncertain[0].notes).toContain('uncertain');
  });

  it('assigns distinct screen positions to different nodes', () => {
    const layout = layoutCircuit(SERIES_ANALYSIS);
    const positions = layout.nodes.map((n) => `${n.x},${n.y}`);
    expect(new Set(positions).size).toBe(layout.nodes.length);
  });
});

/* ------------------------------------------------------------------ *
 * Geometry-preserving layout tests
 * ------------------------------------------------------------------ */

// Circuit WITH geometry (normalised coordinates from image analysis)
const GEOMETRY_ANALYSIS = {
  contains_circuit: true, circuit_type: 'series',
  components: [
    { id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      center: { x: 0.2, y: 0.5 }, orientation: 90,
      terminals: [{ label: '+', position: { x: 0.2, y: 0.35 } }, { label: '−', position: { x: 0.2, y: 0.65 } }] },
    { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      center: { x: 0.5, y: 0.15 }, orientation: 0,
      terminals: [{ label: 'A', position: { x: 0.35, y: 0.15 } }, { label: 'B', position: { x: 0.65, y: 0.15 } }] },
    { id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      center: { x: 0.8, y: 0.5 }, orientation: 90,
      terminals: [{ label: 'A', position: { x: 0.8, y: 0.35 } }, { label: 'B', position: { x: 0.8, y: 0.65 } }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
  wires: [
    { id: 'W1', points: [{x:0.2,y:0.35},{x:0.2,y:0.15},{x:0.35,y:0.15}],
      from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A', confidence: 0.9 },
    { id: 'W2', points: [{x:0.65,y:0.15},{x:0.8,y:0.15},{x:0.8,y:0.35}],
      from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A', confidence: 0.9 },
  ],
  junctions: [],
  nodes: [],
};

// Incomplete circuit (missing closing connection)
const INCOMPLETE_ANALYSIS = {
  contains_circuit: true, circuit_type: 'unknown',
  reconstruction_incomplete: true,
  components: [
    { id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
  ],
  general_notes: 'Could not determine if R1 connects back to V1 negative terminal.',
};

// Rotated components
const ROTATED_ANALYSIS = {
  contains_circuit: true, circuit_type: 'series',
  components: [
    { id: 'V1', type: 'battery', visible_value: '9 V', confidence: 0.9,
      center: { x: 0.15, y: 0.5 }, orientation: 90,
      terminals: [{ label: '+', position: { x: 0.15, y: 0.3 } }, { label: '−', position: { x: 0.15, y: 0.7 } }] },
    { id: 'R1', type: 'resistor', visible_value: '5 Ω', confidence: 0.85,
      center: { x: 0.85, y: 0.5 }, orientation: 90,
      terminals: [{ label: 'A', position: { x: 0.85, y: 0.3 } }, { label: 'B', position: { x: 0.85, y: 0.7 } }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
};

// Wire crossing without junction
const CROSSING_ANALYSIS = {
  contains_circuit: true, circuit_type: 'unknown',
  components: [
    { id: 'V1', type: 'voltage_source', visible_value: '9 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '3 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−',
      notes: 'possible crossing, junction uncertain', confidence: 0.6 },
  ],
  wires: [
    { id: 'W1', points: [{x:0.2,y:0.3},{x:0.5,y:0.5},{x:0.8,y:0.7}],
      from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−',
      is_crossing: true, confidence: 0.6 },
  ],
};

describe('layoutCircuit — geometry-preserving mode', () => {
  it('uses geometry mode when coordinates are available', () => {
    const layout = layoutCircuit(GEOMETRY_ANALYSIS);
    expect(layout.ok).toBe(true);
    expect(layout.hasGeometry).toBe(true);
    expect(layout.isApproximation).toBe(false);
  });

  it('preserves component positions from image coordinates', () => {
    const layout = layoutCircuit(GEOMETRY_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    // V1 center was at (0.2, 0.5) normalized — should be scaled to SVG coords
    expect(v1.center).toBeDefined();
    expect(v1.center.x).toBeGreaterThan(0);
    expect(v1.center.x).toBeLessThan(layout.bounds.width);
  });

  it('preserves component orientation from image', () => {
    const layout = layoutCircuit(GEOMETRY_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    expect(v1.orientation).toBe(90); // vertical battery
    expect(v1.x1).toBe(v1.x2);
    expect(v1.y1).not.toBe(v1.y2);
    const r1 = layout.components.find((c) => c.id === 'R1');
    expect(r1.orientation).toBe(0); // horizontal resistor
    expect(r1.x1).not.toBe(r1.x2);
    expect(r1.y1).toBe(r1.y2);
  });

  it('renders one orthogonal wire per electrical node from extracted geometry', () => {
    const layout = layoutCircuit(GEOMETRY_ANALYSIS);
    // GEOMETRY_ANALYSIS has 3 electrical nodes, each joining exactly 2 terminals,
    // so the drawing needs exactly 3 wire edges (traced polylines are replaced).
    expect(layout.wires).toHaveLength(3);
    for (const w of layout.wires) {
      expect(w.points.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < w.points.length; i += 1) {
        const a = w.points[i - 1];
        const b = w.points[i];
        // No diagonal segments are ever emitted
        expect(a.x === b.x || a.y === b.y).toBe(true);
      }
      for (const p of w.points) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(layout.bounds.width);
      }
    }
    expect(layout.renderValidation.isValid).toBe(true);
  });

  it('preserves electrical connectivity in geometry mode', () => {
    const layout = layoutCircuit(GEOMETRY_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    expect(v1.nodeA).toBe(r1.nodeA); // V1.+ and R1.A share a node
  });

  it('handles rotated components correctly', () => {
    const layout = layoutCircuit(ROTATED_ANALYSIS);
    expect(layout.ok).toBe(true);
    expect(layout.hasGeometry).toBe(true);
    const v1 = layout.components.find((c) => c.id === 'V1');
    expect(v1.orientation).toBe(90);
    // Vertical battery: identical X, different Y
    expect(v1.x1).toBe(v1.x2);
    expect(v1.y1).not.toBe(v1.y2);
    const r1 = layout.components.find((c) => c.id === 'R1');
    expect(r1.orientation).toBe(90);
    expect(r1.x1).toBe(r1.x2);
    expect(r1.y1).not.toBe(r1.y2);
  });
});

describe('layoutCircuit — approximation fallback mode', () => {
  it('uses approximation mode when no geometry is available', () => {
    const layout = layoutCircuit(SERIES_ANALYSIS);
    expect(layout.ok).toBe(true);
    expect(layout.hasGeometry).toBe(false);
    expect(layout.isApproximation).toBe(true);
  });

  it('still preserves electrical connectivity in fallback mode', () => {
    const layout = layoutCircuit(SERIES_ANALYSIS);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');
    expect(v1.nodeA).toBe(r1.nodeA);
    expect(r1.nodeB).toBe(r2.nodeA);
    expect(r2.nodeB).toBe(v1.nodeB);
  });
});

describe('layoutCircuit — uncertainty and incompleteness', () => {
  it('marks incomplete circuits', () => {
    const layout = layoutCircuit(INCOMPLETE_ANALYSIS);
    expect(layout.incomplete).toBe(true);
    expect(layout.isApproximation).toBe(true);
    expect(layout.message).toContain('incomplete');
    expect(layout.message.toLowerCase()).not.toMatch(/successfully completed/);
  });

  it('preserves uncertain connection notes', () => {
    const layout = layoutCircuit(UNCERTAIN_ANALYSIS);
    expect(layout.uncertain.length).toBeGreaterThan(0);
    expect(layout.uncertain[0].notes).toContain('uncertain');
  });

  it('never converts a declared wire crossing into an electrical junction', () => {
    const layout = layoutCircuit(CROSSING_ANALYSIS);
    const graph = buildGraph(CROSSING_ANALYSIS);

    // The V1 +/− terminals are two distinct nodes despite the declared crossing.
    expect(sameNode(graph, 'V1', '+', 'V1', '−')).toBe(false);

    // Both nodes join exactly two terminals, so no junction dot may be drawn.
    expect(layout.junctions).toHaveLength(0);
    expect(layout.nodes.filter((n) => n.isJunction)).toHaveLength(0);

    // And the drawn circuit is still continuous and valid.
    expect(layout.renderValidation.isValid).toBe(true);
  });
});
