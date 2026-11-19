import { describe, expect, it } from 'vitest';
import capture from '../../tests/fixtures/duplicate_singleton_assignment_analysis.json';
import { buildGraph, termKey } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { solveDcCircuit } from './dcSolver.js';

describe('a terminal repeated in a singleton declaration', () => {
  it('replays the captured duplicate assignment with one complete graph for rendering and solving', () => {
    expect(capture.nodes.slice(0, 2).map((node) => node.members)).toEqual([['V1.+'], ['V1.+', 'R1.A']]);
    const graph = buildGraph(capture);
    const expected = [
      ['R1.A', 'V1.+'], ['R1.B', 'R2.A', 'R3.A'], ['R2.B', 'R3.B', 'V1.−'],
    ];
    const partition = (nodes) => nodes.map((node) => [...node.members].sort()).sort();
    expect(partition(graph.nodes)).toEqual(expected);
    const allMembers = graph.nodes.flatMap((node) => node.members);
    expect(allMembers.sort()).toEqual(graph.components.flatMap((component) => component.terminals
      .map((terminal) => termKey(component.id, terminal.label))).sort());
    expect(graph.incomplete).toBe(false);
    expect(graph.validation.warnings).toEqual([]);
    expect(graph.provisional).toEqual([]);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: 'redundant-singleton-assignment-resolved', terminal: 'V1.+', peer: 'R1.A', wireId: 'W1', severity: 'info',
    }));
    const layout = layoutCircuit(capture, graph);
    expect(partition(layout.nodes)).toEqual(expected);
    expect(layout.renderValidation.errors).toEqual([]);
    expect(layout.incomplete).toBe(false);
    const result = solveDcCircuit(graph);
    expect(result.ok).toBe(true);
    const branch = (id) => result.branches.find((entry) => entry.componentId === id);
    expect(branch('R1').current).toBeCloseTo(18 / 7, 12);
    expect(branch('R2').current).toBeCloseTo(12 / 7, 12);
    expect(branch('R3').current).toBeCloseTo(6 / 7, 12);
    expect(branch('V1').voltage / -branch('V1').current).toBeCloseTo(7, 12);
    expect(result.nodes.map((node) => node.id).sort()).toEqual(layout.nodes.map((node) => node.id).sort());
  });

  it.each([
    ['missing trace', (analysis) => analysis.wires.shift()],
    ['crossing trace', (analysis) => { analysis.wires[0].is_crossing = true; }],
    ['short trace', (analysis) => { analysis.wires[0].points.pop(); }],
    ['second populated group', (analysis) => { analysis.nodes[0].members.push('R2.A'); }],
    ['competing terminal claim', (analysis) => {
      analysis.connections.push({ ...analysis.connections[0], to_component: 'R2', status: 'uncertain' });
    }],
  ])('keeps %s unresolved', (_case, change) => {
    const analysis = structuredClone(capture);
    change(analysis);
    const graph = buildGraph(analysis);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: 'conflicting-terminal-assignment', terminal: 'V1.+',
    }));
    expect(graph.incomplete).toBe(true);
    expect(solveDcCircuit(graph).ok).toBe(false);
  });

  it('preserves an explicit extraction blocker after local reconciliation', () => {
    const graph = buildGraph({ ...capture, reconstruction_incomplete: true });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.incomplete).toBe(true);
    expect(solveDcCircuit(graph).ok).toBe(false);
  });
});
