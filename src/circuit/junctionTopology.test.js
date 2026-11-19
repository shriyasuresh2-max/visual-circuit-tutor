import { describe, it, expect } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { reconcileTopology, PROVENANCE } from './topologyReconciliation.js';

/* ------------------------------------------------------------------ *
 * Generic fixtures — no named circuits, ids or coordinates are special
 * ------------------------------------------------------------------ */

const part = (id, labels = ['A', 'B'], type = 'resistor') => ({
  id,
  type,
  visible_value: null,
  terminals: labels.map((label) => ({ label })),
});

const link = (fc, ft, tc, tt, extra = {}) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
  ...extra,
});

const dot = (id, members, extra = {}) => ({ id, members, position: { x: 0, y: 0 }, ...extra });

const analysis = ({ components = [], connections = [], junctions = [], wires = [], nodes = [] }) => ({
  contains_circuit: true,
  components,
  connections,
  junctions,
  wires,
  nodes,
});

const sameNode = (graph, a, b) => graph.nodes.some((n) => n.members.includes(a) && n.members.includes(b));
const nodeSize = (graph, key) => graph.nodes.find((n) => n.members.includes(key))?.members.length ?? 0;
const codes = (graph) => graph.diagnostics.map((d) => d.code);
const edgeFor = (graph, a, b) => graph.topology.edges.filter(
  (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
);

describe('junction membership becomes connectivity', () => {
  it('joins two terminals listed by one dot', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A'])],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(sameNode(g, 'P1.A', 'P1.B')).toBe(false);
    expect(nodeSize(g, 'P1.A')).toBe(1);
    expect(g.topology.edges).toHaveLength(1);
    expect(g.topology.edges[0].provenance).toEqual([PROVENANCE.JUNCTION]);
  });

  it('joins three or more terminals with a linear number of edges', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3')],
      junctions: [dot('dot1', ['P1.B', 'P2.A', 'P3.A'])],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(sameNode(g, 'P2.A', 'P3.A')).toBe(true);
    // n members → n−1 claims, never every pair.
    expect(g.topology.edges).toHaveLength(2);
    expect(new Set(g.nodes.flatMap((n) => n.members)).size).toBe(6);
  });

  it('keeps different dots on different nodes', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3')],
      junctions: [dot('dot1', ['P1.B', 'P2.A']), dot('dot2', ['P2.B', 'P3.A'])],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(sameNode(g, 'P2.B', 'P3.A')).toBe(true);
    expect(sameNode(g, 'P1.B', 'P2.B')).toBe(false);
    expect(g.nodes).toHaveLength(4);
  });
});

describe('junction evidence merges with the other sources', () => {
  it('deduplicates an explicit connection that names the same pair', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      connections: [link('P1', 'B', 'P2', 'A', { confidence: 0.99, status: 'confirmed' })],
      junctions: [dot('dot1', ['P1.B', 'P2.A'])],
    }));
    const edges = edgeFor(g, 'P1.B', 'P2.A');
    expect(edges).toHaveLength(1);
    expect(edges[0].provenance).toContain(PROVENANCE.EXPLICIT);
    expect(edges[0].provenance).toContain(PROVENANCE.JUNCTION);
    expect(edges[0].confirmed).toBe(true);
    expect(edges[0].confidence).toBe(0.99);
  });

  it('deduplicates a node group that names the same pair', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      nodes: [{ id: 'group1', members: ['P1.B', 'P2.A'] }],
      junctions: [dot('dot1', ['P2.A', 'P1.B'])],
    }));
    const edges = edgeFor(g, 'P1.B', 'P2.A');
    expect(edges).toHaveLength(1);
    expect(edges[0].provenance).toContain(PROVENANCE.NODE_GROUP);
    expect(edges[0].provenance).toContain(PROVENANCE.JUNCTION);
  });

  it('does not let a duplicate wire demote a junction claim', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A'])],
      wires: [link('P1', 'B', 'P2', 'A', { id: 'w1', confidence: 0.95, is_junction: true })],
    }));
    const edges = edgeFor(g, 'P1.B', 'P2.A');
    expect(edges).toHaveLength(1);
    expect(edges[0].provenance).toContain(PROVENANCE.INFERRED_WIRE);
    // The junction states no confidence; a derived wire default must not turn
    // that into a provisional edge.
    expect(edges[0].confidence).toBeNull();
    expect(edges[0].confirmed).toBe(true);
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
  });

  it('ignores wire-end pseudo members but keeps the valid ones', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'W1.to', 'P2.A'])],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(codes(g)).toContain('junction-member-not-a-terminal');
    expect(g.diagnostics.find((d) => d.code === 'junction-member-not-a-terminal').key).toBe('W1.to');
  });

  it('says so when a dot cannot join anything', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B'])],
    }));
    expect(g.topology.edges).toHaveLength(0);
    expect(codes(g)).toContain('junction-insufficient-members');
    expect(nodeSize(g, 'P1.B')).toBe(1);
  });

  it('survives missing or malformed membership', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [{ id: 'dot1' }, { id: 'dot2', members: 'P1.B' }, { id: 'dot3', members: [null, 42] }],
    }));
    expect(codes(g).filter((c) => c === 'junction-members-missing')).toHaveLength(2);
    expect(g.topology.edges).toHaveLength(0);
    expect(g.nodes).toHaveLength(4);
  });
});

describe('junction evidence never overrides stronger confirmed evidence', () => {
  it('withholds a pair that confirmed connections already place apart', () => {
    // Explicit evidence puts the source across P1; the dot claims P1's own
    // terminals share a node, which would short the source.
    const g = buildGraph(analysis({
      components: [part('S1', ['+', '−'], 'battery'), part('P1')],
      connections: [
        link('S1', '+', 'P1', 'A', { confidence: 0.99, status: 'confirmed' }),
        link('S1', '−', 'P1', 'B', { confidence: 0.99, status: 'confirmed' }),
      ],
      junctions: [dot('dot1', ['P1.A', 'P1.B'])],
    }));
    expect(sameNode(g, 'P1.A', 'P1.B')).toBe(false);
    expect(sameNode(g, 'S1.+', 'S1.−')).toBe(false);
    expect(codes(g)).toContain('junction-conflicts-with-evidence');
  });

  it('still joins unassigned members when only one member is placed', () => {
    // One member is placed by explicit evidence, the other two are unassigned:
    // nothing contradicts the dot, so its whole membership is joined.
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3')],
      connections: [
        link('P1', 'B', 'P3', 'B', { confidence: 0.99, status: 'confirmed' }),
      ],
      junctions: [dot('dot1', ['P1.A', 'P1.B', 'P2.A'])],
    }));
    expect(sameNode(g, 'P1.A', 'P1.B')).toBe(true);
    expect(sameNode(g, 'P1.A', 'P2.A')).toBe(true);
    // The dot says nothing about P3.A, so it stays alone.
    expect(sameNode(g, 'P1.A', 'P3.A')).toBe(false);
    expect(nodeSize(g, 'P3.A')).toBe(1);
    expect(codes(g)).not.toContain('junction-conflicts-with-evidence');
  });

  it('applies a dot whose placed members already agree', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3')],
      connections: [
        link('P1', 'A', 'P2', 'A', { confidence: 0.99, status: 'confirmed' }),
      ],
      junctions: [dot('dot1', ['P1.A', 'P2.A', 'P3.A'])],
    }));
    expect(sameNode(g, 'P1.A', 'P3.A')).toBe(true);
    expect(codes(g)).not.toContain('junction-conflicts-with-evidence');
  });

  it('reports a contradicting dot instead of merging it', () => {
    const g = buildGraph(analysis({
      components: [part('S1', ['+', '−'], 'battery'), part('P1'), part('P2')],
      connections: [
        link('S1', '+', 'P1', 'A', { confidence: 0.99, status: 'confirmed' }),
        link('S1', '−', 'P2', 'A', { confidence: 0.99, status: 'confirmed' }),
      ],
      junctions: [dot('dot1', ['P1.A', 'P2.A', 'P2.B'])],
    }));
    // P1.A and P2.A are placed on opposite sides of the source by stronger
    // evidence, so the dot that joins them is withheld as a whole.
    expect(sameNode(g, 'P1.A', 'P2.A')).toBe(false);
    expect(sameNode(g, 'P2.A', 'P2.B')).toBe(false);
    expect(codes(g)).toContain('junction-conflicts-with-evidence');
  });

  it('retains the independently supported part of a split dot and leaves its ambiguous member open', () => {
    const g = buildGraph(analysis({
      components: ['P', 'Q', 'R', 'S', 'T'].map((id) => part(id)),
      connections: [link('P', 'A', 'Q', 'A'), link('R', 'A', 'S', 'A')],
      junctions: [dot('branch', ['T.A', 'R.A', 'P.A', 'Q.A'])],
    }));
    expect(edgeFor(g, 'P.A', 'Q.A')[0].provenance).toContain(PROVENANCE.JUNCTION);
    expect(sameNode(g, 'P.A', 'R.A')).toBe(false);
    expect(nodeSize(g, 'T.A')).toBe(1);
    expect(g.diagnostics.find((d) => d.code === 'junction-conflicts-with-evidence').retained)
      .toEqual([['P.A', 'Q.A']]);
    expect(g.validation.warnings).toContainEqual(expect.stringContaining('T.A (possible orphan)'));
    expect(g.incomplete).toBe(true);
  });

  it('withholds a chain of individually plausible dots that together join distinct established nets', () => {
    const junctions = [dot('left', ['P.A', 'T.A']), dot('right', ['T.A', 'R.A'])];
    for (const ordered of [junctions, [...junctions].reverse()]) {
      const g = buildGraph(analysis({
        components: ['P', 'Q', 'R', 'S', 'T'].map((id) => part(id)),
        connections: [link('P', 'A', 'Q', 'A'), link('R', 'A', 'S', 'A')],
        junctions: ordered,
      }));
      expect(sameNode(g, 'P.A', 'Q.A')).toBe(true);
      expect(sameNode(g, 'R.A', 'S.A')).toBe(true);
      expect(sameNode(g, 'P.A', 'R.A')).toBe(false);
      expect(nodeSize(g, 'T.A')).toBe(1);
      expect(codes(g).filter((code) => code === 'junction-conflicts-with-evidence')).toHaveLength(2);
    }
  });
});

describe('declared node partitions', () => {
  it('preserves uncontested group members when one terminal is assigned twice', () => {
    const g = buildGraph(analysis({
      components: ['P', 'Q', 'T'].map((id) => part(id)),
      nodes: [
        { id: 'left', members: ['P.A', 'Q.A', 'T.A'] },
        { id: 'right', members: ['P.B', 'Q.B', 'T.A'] },
      ],
    }));
    expect(sameNode(g, 'P.A', 'Q.A')).toBe(true);
    expect(sameNode(g, 'P.B', 'Q.B')).toBe(true);
    expect(sameNode(g, 'P.A', 'P.B')).toBe(false);
    expect(nodeSize(g, 'T.A')).toBe(1);
    expect(codes(g)).toContain('conflicting-terminal-assignment');
  });

  it('preserves an unassigned region while withholding direct and transitive cross-net claims', () => {
    const g = buildGraph(analysis({
      components: ['P', 'Q', 'T', 'U'].map((id) => part(id)),
      nodes: [{ id: 'left', members: ['P.A', 'Q.A'] }, { id: 'right', members: ['P.B', 'Q.B'] }],
      connections: [
        link('P', 'A', 'T', 'A'), link('T', 'A', 'U', 'A'),
        link('U', 'A', 'P', 'B'), link('Q', 'A', 'Q', 'B'),
      ],
    }));
    expect(sameNode(g, 'T.A', 'U.A')).toBe(true);
    expect(sameNode(g, 'P.A', 'Q.A')).toBe(true);
    expect(sameNode(g, 'P.B', 'Q.B')).toBe(true);
    expect(sameNode(g, 'P.A', 'P.B')).toBe(false);
    expect(sameNode(g, 'P.A', 'T.A')).toBe(false);
    expect(sameNode(g, 'P.B', 'U.A')).toBe(false);
    expect(g.provisional.map((edge) => edge.reason)).toEqual(Array(3).fill('declared-node-conflict'));
    expect(g.validation.warnings).toContainEqual(expect.stringContaining('Reported connection Q.A to Q.B is split'));
  });

  it('does not present a fully populated but contradictory graph as complete', () => {
    const g = buildGraph(analysis({
      components: [part('P'), part('Q')],
      connections: [link('P', 'A', 'Q', 'A'), link('P', 'B', 'Q', 'B')],
      junctions: [dot('unclear-branch', ['P.A', 'P.B'])],
    }));
    expect(g.nodes.map((n) => n.members.length)).toEqual([2, 2]);
    expect(g.incomplete).toBe(true);
  });
});

describe('junction confidence and status', () => {
  it('keeps an uncertain dot provisional', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A'], { status: 'uncertain' })],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(false);
    expect(g.provisional).toHaveLength(1);
    expect(g.provisional[0].provenance).toEqual([PROVENANCE.JUNCTION]);
    const split = g.diagnostics.find((d) => d.code === 'junction-members-split');
    expect(split).toBeTruthy();
    expect(split.provisional).toBe(true);
    expect(split.message).toMatch(/provisional/);
  });

  it('keeps a low-confidence dot provisional', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A'], { confidence: 0.4 })],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(false);
    expect(g.provisional).toHaveLength(1);
  });

  it('lets a marked-confirmed junction merge', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A'], { status: 'probable', confidence: 0.8 })],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(g.topology.edges[0].status).toBe('probable');
    expect(g.topology.edges[0].confidence).toBe(0.8);
  });
});

describe('reconciliation is topology-independent', () => {
  it('preserves a multi-loop bridge from physical junctions without joining crossing wires', () => {
    const junctions = [
      dot('north', ['P.A', 'Q.A', 'S.A']),
      dot('west', ['P.B', 'R.A', 'T.A']),
      dot('east', ['Q.B', 'U.A', 'T.B']),
      dot('south', ['R.B', 'U.B', 'S.B']),
    ];
    const g = buildGraph(analysis({
      components: ['P', 'Q', 'R', 'S', 'T', 'U'].map((id) => part(id)),
      junctions,
      wires: [
        link('P', 'B', 'R', 'A', { id: 'w1', is_crossing: true, points: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }] }),
        link('Q', 'B', 'U', 'A', { id: 'w2', is_crossing: true, points: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }] }),
      ],
    }));
    expect(g.nodes.map((node) => [...node.members].sort())).toEqual(
      junctions.map((junction) => [...junction.members].sort()),
    );
    expect(g.crossings.map((crossing) => crossing.wireId)).toEqual(['w1', 'w2']);
    expect(g.incomplete).toBe(false);
  });

  it('reports a degenerate trace that disagrees with the confirmed graph', () => {
    const g = buildGraph(analysis({
      components: [part('P'), part('Q')],
      connections: [link('P', 'A', 'Q', 'A'), link('P', 'B', 'Q', 'B')],
      wires: [link('P', 'A', 'Q', 'B', {
        id: 'broken', points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
      })],
    }));
    expect(codes(g)).toEqual(expect.arrayContaining(['incomplete-wire-trace', 'wire-trace-node-disagreement']));
    expect(g.validation.warnings).toContainEqual(expect.stringContaining('Wire broken'));
    expect(sameNode(g, 'P.A', 'Q.B')).toBe(false);
    expect(g.incomplete).toBe(true);
  });

  it('builds unrelated shapes from junction evidence alone', () => {
    const chain = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3')],
      junctions: [dot('d1', ['P1.B', 'P2.A']), dot('d2', ['P2.B', 'P3.A'])],
    }));
    const star = buildGraph(analysis({
      components: [part('Q1', ['A', 'B', 'C']), part('Q2')],
      junctions: [dot('d1', ['Q1.A', 'Q1.B', 'Q1.C', 'Q2.B'])],
    }));
    expect(chain.nodes).toHaveLength(4);
    expect(star.nodes).toHaveLength(2);
    expect(nodeSize(star, 'Q2.B')).toBe(4);
  });

  it('handles two disjoint circuits in one response', () => {
    const g = buildGraph(analysis({
      components: [part('P1'), part('P2'), part('P3'), part('P4')],
      junctions: [dot('d1', ['P1.B', 'P2.A']), dot('d2', ['P3.B', 'P4.A'])],
    }));
    expect(sameNode(g, 'P1.B', 'P2.A')).toBe(true);
    expect(sameNode(g, 'P3.B', 'P4.A')).toBe(true);
    expect(sameNode(g, 'P1.B', 'P3.B')).toBe(false);
    expect(g.nodes).toHaveLength(6);
  });

  it('reports the same partition through reconcileTopology directly', () => {
    const { edges, diagnostics } = reconcileTopology(analysis({
      components: [part('P1'), part('P2')],
      junctions: [dot('dot1', ['P1.B', 'P2.A', 'W9.from'])],
    }));
    expect(edges).toHaveLength(1);
    expect(edges[0].provenance).toEqual([PROVENANCE.JUNCTION]);
    expect(edges[0].junctionIds).toEqual(['dot1']);
    expect(diagnostics.map((d) => d.code)).toContain('junction-member-not-a-terminal');
  });
});
