import { describe, it, expect } from 'vitest';
import { buildGraph, validateGraph, validateAnalysis, computeNodes, findCycle, sameNode, componentsAtNode } from './electricalGraph.js';

/* ------------------------------------------------------------------ *
 * Test fixtures — various circuit topologies with and without geometry
 * ------------------------------------------------------------------ */

// Series: V1(12V) — R1(4Ω) — R2(6Ω) — back to V1
const SERIES = {
  contains_circuit: true, circuit_type: 'series',
  components: [
    { id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
};

// Parallel: V1 || R1 || R2
const PARALLEL = {
  contains_circuit: true, circuit_type: 'parallel',
  components: [
    { id: 'V1', type: 'battery', visible_value: '12 V', confidence: 0.95,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '4 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.9,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R1', to_terminal: 'B' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R2', to_terminal: 'B' },
  ],
};

// Bridge: R1-R2-R3-R4 diamond with R5 bridging
//   Nodes: N0 (top), N1 (left), N2 (right), N3 (bottom)
//   R1: N0-N1, R2: N0-N2, R3: N1-N3, R4: N2-N3, R5: N1-N2 (bridge)
//   V1: N0-N3 (source across the bridge)
const BRIDGE = {
  contains_circuit: true, circuit_type: 'mixed',
  components: [
    { id: 'V1', type: 'voltage_source', visible_value: '10 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '1 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R2', type: 'resistor', visible_value: '2 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R3', type: 'resistor', visible_value: '3 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R4', type: 'resistor', visible_value: '4 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R5', type: 'resistor', visible_value: '5 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    // V1 across top-bottom
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '+', to_component: 'R2', to_terminal: 'A' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R3', to_terminal: 'B' },
    { from_component: 'V1', from_terminal: '−', to_component: 'R4', to_terminal: 'B' },
    // R1 (left arm): top to left node
    { from_component: 'R1', from_terminal: 'B', to_component: 'R3', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'R5', to_terminal: 'A' },
    // R2 (right arm): top to right node
    { from_component: 'R2', from_terminal: 'B', to_component: 'R4', to_terminal: 'A' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'R5', to_terminal: 'B' },
  ],
};

// Crossing without junction (two wires that cross but don't connect)
const CROSSING_NO_JUNCTION = {
  contains_circuit: true, circuit_type: 'unknown',
  components: [
    { id: 'V1', type: 'voltage_source', visible_value: '9 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '3 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'R2', type: 'resistor', visible_value: '6 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−',
      notes: 'wire crosses R2 wire without junction dot', confidence: 0.7 },
    { from_component: 'R2', from_terminal: 'A', to_component: 'V1', to_terminal: '+' },
    { from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−' },
  ],
  wires: [
    { id: 'W1', points: [{x:0.2,y:0.3},{x:0.5,y:0.5},{x:0.8,y:0.7}],
      from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '−',
      is_crossing: true, confidence: 0.7 },
  ],
};

// Incomplete circuit (missing a connection)
const INCOMPLETE = {
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
    // Missing: R1.B -> V1.- (circuit not closed)
  ],
  general_notes: 'Could not determine if R1 connects back to V1 negative terminal.',
};

// With geometry (normalised coordinates)
const WITH_GEOMETRY = {
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
    { id: 'W3', points: [{x:0.8,y:0.65},{x:0.8,y:0.85},{x:0.2,y:0.85},{x:0.2,y:0.65}],
      from_component: 'R2', from_terminal: 'B', to_component: 'V1', to_terminal: '−', confidence: 0.9 },
  ],
  junctions: [],
  nodes: [],
};

// Multiple sources
const MULTIPLE_SOURCES = {
  contains_circuit: true, circuit_type: 'mixed',
  components: [
    { id: 'V1', type: 'voltage_source', visible_value: '10 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'V2', type: 'voltage_source', visible_value: '5 V', confidence: 0.9,
      terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'R1', type: 'resistor', visible_value: '2 Ω', confidence: 0.85,
      terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  connections: [
    { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
    { from_component: 'R1', from_terminal: 'B', to_component: 'V2', to_terminal: '+' },
    { from_component: 'V2', from_terminal: '−', to_component: 'V1', to_terminal: '−' },
  ],
};

// Rotated components (vertical orientation)
const ROTATED = {
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

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('buildGraph — canonical electrical graph', () => {
  it('builds correct nodes for a series circuit', () => {
    const graph = buildGraph(SERIES);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.components).toHaveLength(3);
    // V1.+ and R1.A share a node
    expect(sameNode(graph, 'V1', '+', 'R1', 'A')).toBe(true);
    // R1.B and R2.A share a node
    expect(sameNode(graph, 'R1', 'B', 'R2', 'A')).toBe(true);
    // R2.B and V1.- share a node (closes the loop)
    expect(sameNode(graph, 'R2', 'B', 'V1', '−')).toBe(true);
    // V1.+ and V1.- are different nodes
    expect(sameNode(graph, 'V1', '+', 'V1', '−')).toBe(false);
  });

  it('builds correct nodes for a parallel circuit (2 nodes)', () => {
    const graph = buildGraph(PARALLEL);
    expect(graph.nodes).toHaveLength(2);
    expect(sameNode(graph, 'V1', '+', 'R1', 'A')).toBe(true);
    expect(sameNode(graph, 'V1', '+', 'R2', 'A')).toBe(true);
    expect(sameNode(graph, 'V1', '−', 'R1', 'B')).toBe(true);
    expect(sameNode(graph, 'V1', '−', 'R2', 'B')).toBe(true);
  });

  it('builds correct nodes for a bridge circuit (4 nodes)', () => {
    const graph = buildGraph(BRIDGE);
    // Bridge has 4 nodes: top, left, right, bottom
    expect(graph.nodes).toHaveLength(4);
    // R1.B, R3.A, R5.A share the left node
    expect(sameNode(graph, 'R1', 'B', 'R3', 'A')).toBe(true);
    expect(sameNode(graph, 'R1', 'B', 'R5', 'A')).toBe(true);
    // R2.B, R4.A, R5.B share the right node
    expect(sameNode(graph, 'R2', 'B', 'R4', 'A')).toBe(true);
    expect(sameNode(graph, 'R2', 'B', 'R5', 'B')).toBe(true);
    // R5 bridges left and right (different nodes)
    expect(sameNode(graph, 'R5', 'A', 'R5', 'B')).toBe(false);
  });

  it('handles multiple voltage sources in series', () => {
    const graph = buildGraph(MULTIPLE_SOURCES);
    expect(graph.components).toHaveLength(3);
    expect(sameNode(graph, 'R1', 'B', 'V2', '+')).toBe(true);
    expect(sameNode(graph, 'V2', '−', 'V1', '−')).toBe(true);
  });

  it('detects geometry availability', () => {
    expect(buildGraph(WITH_GEOMETRY).hasGeometry).toBe(true);
    expect(buildGraph(SERIES).hasGeometry).toBe(false);
  });

  it('preserves component center and orientation from geometry', () => {
    const graph = buildGraph(WITH_GEOMETRY);
    const v1 = graph.components.find((c) => c.id === 'V1');
    expect(v1.center).toEqual({ x: 0.2, y: 0.5 });
    expect(v1.orientation).toBe(90);
  });

  it('preserves wire paths from geometry', () => {
    const graph = buildGraph(WITH_GEOMETRY);
    expect(graph.wires).toHaveLength(3);
    expect(graph.wires[0].points).toBeDefined();
    expect(graph.wires[0].points.length).toBeGreaterThanOrEqual(2);
    expect(graph.wires[0].points[0]).toEqual({ x: 0.2, y: 0.35 });
  });

  it('preserves component bounding boxes when provided', () => {
    const withBox = {
      ...WITH_GEOMETRY,
      components: WITH_GEOMETRY.components.map((c, i) => (
        i === 0
          ? { ...c, bbox: { x: 0.1, y: 0.4, width: 0.08, height: 0.2 } }
          : c
      )),
    };
    const graph = buildGraph(withBox);
    const v1 = graph.components.find((c) => c.id === 'V1');
    expect(v1.bbox).toEqual({ x: 0.1, y: 0.4, width: 0.08, height: 0.2 });
    expect(v1.width).toBe(0.08);
    expect(v1.height).toBe(0.2);
  });

  it('marks crossings from wire flags', () => {
    const graph = buildGraph(CROSSING_NO_JUNCTION);
    expect(graph.crossings.length).toBeGreaterThan(0);
  });

  it('does not create junctions from unconnected crossings', () => {
    const graph = buildGraph(CROSSING_NO_JUNCTION);
    expect(graph.junctions).toHaveLength(0);
    expect(graph.wires[0].isCrossing).toBe(true);
  });
});

describe('validateGraph — integrity checking', () => {
  it('passes for a valid series circuit', () => {
    const graph = buildGraph(SERIES);
    expect(graph.validation.isValid).toBe(true);
    expect(graph.validation.errors).toHaveLength(0);
  });

  it('passes for a valid bridge circuit', () => {
    const graph = buildGraph(BRIDGE);
    expect(graph.validation.isValid).toBe(true);
  });

  it('reports incomplete for missing connections', () => {
    const graph = buildGraph(INCOMPLETE);
    expect(graph.incomplete).toBe(true);
  });

  it('detects connections to unknown components', () => {
    const bad = {
      components: [{ id: 'V1', type: 'battery', confidence: 0.9, terminals: [{label:'+'},{label:'−'}] }],
      connections: [{ from_component: 'V1', from_terminal: '+', to_component: 'X1', to_terminal: 'A' }],
    };
    const graph = buildGraph(bad);
    expect(graph.validation.isValid).toBe(false);
    expect(graph.validation.errors.some((e) => e.includes('X1'))).toBe(true);
  });
});

describe('findCycle — loop detection', () => {
  it('finds a 3-node cycle in a closed series circuit', () => {
    const { nodeOf } = computeNodes(SERIES.components, SERIES.connections);
    const cycle = findCycle(SERIES.components, nodeOf);
    expect(cycle).not.toBeNull();
    expect(cycle.length).toBe(3);
  });

  it('returns null for an open incomplete circuit', () => {
    const { nodeOf } = computeNodes(INCOMPLETE.components, INCOMPLETE.connections);
    const cycle = findCycle(INCOMPLETE.components, nodeOf);
    expect(cycle).toBeNull();
  });

  it('detects a cycle in a parallel 2-node multigraph', () => {
    const { nodeOf } = computeNodes(PARALLEL.components, PARALLEL.connections);
    const cycle = findCycle(PARALLEL.components, nodeOf);
    expect(cycle).not.toBeNull();
    expect(cycle.length).toBeGreaterThanOrEqual(2);
  });
});

describe('validateAnalysis — extraction sanitization', () => {
  it('does not invent connections for missing data', () => {
    const { analysis } = validateAnalysis(INCOMPLETE);
    expect(analysis.connections).toHaveLength(1);
  });

  it('clamps malformed coordinates without dropping components', () => {
    const { analysis, isValid } = validateAnalysis({
      components: [
        { id: 'V1', type: 'battery', center: { x: -0.2, y: 1.5 }, terminals: [{ label: '+' }, { label: '-' }] },
      ],
      connections: [],
    });
    expect(isValid).toBe(true);
    expect(analysis.components).toHaveLength(1);
    expect(analysis.components[0].center.x).toBe(0);
    expect(analysis.components[0].center.y).toBe(1);
    expect(analysis.components[0].terminals[1].label).toBe('−');
  });
});

describe('sameNode and componentsAtNode — graph queries', () => {
  it('correctly identifies same-node terminals', () => {
    const graph = buildGraph(PARALLEL);
    expect(sameNode(graph, 'R1', 'A', 'R2', 'A')).toBe(true);
    expect(sameNode(graph, 'R1', 'A', 'R1', 'B')).toBe(false);
  });

  it('lists all components at a node', () => {
    const graph = buildGraph(PARALLEL);
    const topNode = graph.components.find((c) => c.id === 'R1').terminals.find((t) => t.label === 'A').node;
    const members = componentsAtNode(graph, topNode);
    expect(members.length).toBe(3); // V1.+, R1.A, R2.A
  });
});
