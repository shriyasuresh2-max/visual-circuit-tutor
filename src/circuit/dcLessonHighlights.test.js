import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { solveDcCircuit } from './dcSolver.js';
import { parseDcQuestion } from './dcQuestions.js';
import { buildDcLesson } from './dcLesson.js';
import { mapLessonHighlights } from './dcLessonHighlights.js';
import { placeDcCurrentArrows } from './dcCurrentArrows.js';

const analysis = {
  contains_circuit: true,
  components: [
    { id: 'S', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '−' }] },
    ...['RA', 'RB', 'RT'].map((id) => ({
      id, type: 'resistor', visible_value: '4 Ω', terminals: [{ label: 'A' }, { label: 'B' }],
    })),
  ],
  nodes: [
    { id: 'input', members: ['S.+', 'RA.A', 'RB.A'] },
    { id: 'middle', members: ['RA.B', 'RB.B', 'RT.A'] },
    { id: 'return', members: ['S.−', 'RT.B'] },
  ],
};

function fixture(question = 'Current through RA') {
  const graph = buildGraph(analysis);
  const layout = layoutCircuit(analysis, graph);
  const solved = solveDcCircuit(graph);
  const { steps } = buildDcLesson(graph, solved, parseDcQuestion(question));
  const map = (stepId) => mapLessonHighlights(graph, layout, steps.find((step) => step.id === stepId));
  return { graph, layout, solved, map };
}

describe('mapLessonHighlights', () => {
  it('keeps motion on separately verified branches in a multi-loop graph', () => {
    const { graph, layout, solved } = fixture('All branch currents');
    const { steps } = buildDcLesson(graph, solved, parseDcQuestion('All branch currents'));
    const step = steps.find(({ id }) => id === 'solve');
    const flows = placeDcCurrentArrows(layout, step, mapLessonHighlights(graph, layout, step))
      .filter((arrow) => arrow.flowPath);
    expect(flows.length).toBeGreaterThan(1);
    for (const arrow of flows) {
      const branch = step.currentDirections.find(({ branchId }) => branchId === arrow.branchId);
      const wire = layout.allWires.find(({ id }) => id === arrow.wireId);
      expect([branch.fromNodeId, branch.toNodeId]).toContain(wire.node);
      expect([wire.from, wire.to].some((terminal) =>
        terminal === `${branch.branchId}.${branch.fromTerminal}` ||
        terminal === `${branch.branchId}.${branch.toTerminal}`)).toBe(true);
    }
  });
  it('emphasizes the reference node and distinguishes the unknown-voltage nodes', () => {
    const { map, solved } = fixture();
    const focus = map('reference');
    expect(focus.nodes.get(solved.referenceNodeId)).toBe('reference');
    const source = solved.branches.find(({ componentId }) => componentId === 'S');
    expect(focus.nodes.get(source.fromNodeId)).toBe('node');
    const unknown = solved.nodes.find(({ id }) => id !== solved.referenceNodeId && id !== source.fromNodeId);
    expect(focus.nodes.get(unknown.id)).toBe('unknown');
    expect(focus.componentIds).toEqual(new Set(['S', 'RA', 'RB', 'RT']));
  });

  it('maps KCL nodes and their incident branches and wires', () => {
    const { graph, layout, map, solved } = fixture();
    const focus = map('kcl');
    expect(focus.nodes.size).toBe(1);
    expect([...focus.nodes.values()]).toEqual(['kcl']);
    expect(focus.componentIds).toEqual(new Set(['RA', 'RB', 'RT']));
    expect(focus.wireIds).toEqual(new Set(layout.allWires.map(({ id }) => id)));
    const [nodeId] = focus.nodes.keys();
    const oneRow = buildDcLesson(graph, solved, parseDcQuestion('All node voltages')).steps.find(({ id }) => id === 'kcl');
    const [equation] = oneRow.equations.filter((row) => row.nodeId === nodeId);
    const subjects = mapLessonHighlights(graph, layout, {
      nodeIds: [nodeId], branchIds: equation.terms.map(({ branchId }) => branchId), equations: [equation],
    });
    expect(subjects.nodes.get(nodeId)).toBe('kcl');
    expect(subjects.componentIds).toEqual(new Set(equation.terms.map(({ branchId }) => branchId)));
  });

  it('narrows the final step to a named resistor and every routed piece of each terminal net', () => {
    const { layout, map } = fixture();
    const final = map('answer');
    expect([...final.componentIds]).toEqual(['RA']);
    const expected = layout.allWires.filter((wire) => final.nodes.has(wire.node));
    expect(expected.length).toBeGreaterThan(final.nodes.size);
    expect(final.wireIds).toEqual(new Set(expected.map(({ id }) => id)));
    expect(map('kcl').wireIds.size).toBeGreaterThan(final.wireIds.size);
  });

  it('recognizes source constraints and source-specific answers as a component branch', () => {
    const { map } = fixture('Current supplied by S');
    for (const step of ['constraints', 'answer']) {
      const focus = map(step);
      expect([...focus.componentIds]).toEqual(['S']);
      expect(focus.nodes.size).toBe(2);
      expect(focus.wireIds.size).toBeGreaterThan(1);
    }
  });

  it('fails closed for missing IDs, inconsistent node membership and foreign wire endpoints', () => {
    const { graph, layout } = fixture();
    const invalid = mapLessonHighlights(graph, layout, {
      nodeIds: ['missing'], componentIds: ['unknown'], branchIds: ['W1'],
      equations: [{ kind: 'reference', nodeId: graph.nodes[0].id }],
    });
    expect(invalid.active).toBe(false);
    const compromised = structuredClone(layout);
    const nodeId = graph.nodes[0].id;
    const wire = compromised.allWires.find((segment) => segment.node === nodeId);
    wire.to = 'RT.B';
    const step = { nodeIds: [nodeId] };
    expect(mapLessonHighlights(graph, compromised, step).wireIds.has(wire.id)).toBe(false);
    compromised.nodes.find(({ id }) => id === nodeId).members = ['RT.B'];
    expect(mapLessonHighlights(graph, compromised, step).active).toBe(false);
    expect(mapLessonHighlights(graph, layout, null).active).toBe(false);
  });
});
