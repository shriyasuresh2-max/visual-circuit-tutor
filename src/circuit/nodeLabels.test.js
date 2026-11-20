import { describe, expect, it } from 'vitest';
import currentSourceAnalysis from '../../tests/fixtures/dc_current_source_analysis.json';
import { layoutCircuit } from './circuitLayout.js';
import { placeNodeLabels } from './nodeLabels.js';
import { segmentIntersectsBox } from './labelMetrics.js';

const separated = (a, b) => a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY;

describe('visible electrical node labels', () => {
  it('places exactly one label per node at a bend or terminal in a two-node loop', () => {
    const layout = layoutCircuit({
      ...currentSourceAnalysis,
      components: currentSourceAnalysis.components.filter(({ type }) => type !== 'voltage_source'),
      nodes: currentSourceAnalysis.nodes.map((node) => ({
        ...node, members: node.members.filter((member) => !member.startsWith('V1.')),
      })),
    });
    const before = structuredClone(layout.nodes);
    const labels = placeNodeLabels(layout);
    expect(labels.map(({ nodeId }) => nodeId)).toEqual(layout.nodes.map(({ id }) => id));
    for (const { nodeId, anchor } of labels) {
      expect(['corner', 'terminal']).toContain(anchor.kind);
      const eligible = anchor.kind === 'corner'
        ? layout.wires.filter(({ node }) => node === nodeId).flatMap(({ points }) => points.slice(1, -1))
        : layout.components.flatMap(({ terminals }) => terminals.filter(({ node }) => node === nodeId));
      expect(eligible).toContainEqual(expect.objectContaining({ x: anchor.x, y: anchor.y }));
    }
    expect(layout.nodes).toEqual(before);
    expect(placeNodeLabels(layout)).toEqual(labels);
  });

  it('prefers genuine three-path junctions and keeps enlarged labels clear of drawn geometry', () => {
    const layout = layoutCircuit(currentSourceAnalysis);
    const labels = placeNodeLabels(layout, 24);
    expect(labels).toHaveLength(layout.nodes.length);
    for (const { nodeId, anchor, box, conflicts } of labels) {
      expect(anchor.kind).toBe('junction');
      expect(layout.junctions).toContainEqual(expect.objectContaining({
        id: anchor.junctionId, nodeId, x: anchor.x, y: anchor.y, isBranchPoint: true,
      }));
      expect(conflicts).toBe(0);
      for (const { symbolBox, labelBox } of layout.components) {
        expect(separated(box, symbolBox)).toBe(true);
        expect(separated(box, labelBox)).toBe(true);
      }
      expect(layout.wires.some(({ points }) => points.slice(1)
        .some((point, i) => segmentIntersectsBox(points[i], point, box)))).toBe(false);
    }
    expect(separated(labels[0].box, labels[1].box)).toBe(true);
  });

  it('uses a component terminal on a straight run and skips a collinear intermediate point', () => {
    const layout = {
      bounds: { width: 200, height: 120 },
      nodes: [{ id: 'N0', x: 100, y: 55 }],
      components: [{ terminals: [{ node: 'N0', x: 20, y: 55 }] }],
      wires: [{ node: 'N0', points: [{ x: 20, y: 55 }, { x: 100, y: 55 }, { x: 175, y: 55 }] }],
    };
    expect(placeNodeLabels(layout)).toMatchObject([{
      nodeId: 'N0', anchor: { x: 20, y: 55, kind: 'terminal' }, conflicts: 0,
    }]);
  });

  it('finds a corner where two wire paths meet without treating the bend as a separate node', () => {
    const layout = {
      bounds: { width: 200, height: 120 },
      nodes: [{ id: 'N0', x: 100, y: 55 }],
      components: [{ terminals: [{ node: 'N0', x: 20, y: 55 }] }],
      wires: [
        { node: 'N0', points: [{ x: 20, y: 55 }, { x: 100, y: 55 }] },
        { node: 'N0', points: [{ x: 100, y: 55 }, { x: 100, y: 100 }] },
      ],
    };
    expect(placeNodeLabels(layout)).toMatchObject([{
      nodeId: 'N0', anchor: { x: 100, y: 55, kind: 'corner' }, conflicts: 0,
    }]);
  });
});
