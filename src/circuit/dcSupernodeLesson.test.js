import { describe, expect, it } from 'vitest';
import analysis from '../../tests/fixtures/dc_supernode_analysis.json';
import { layoutCircuit } from './circuitLayout.js';
import { buildDcLesson } from './dcLesson.js';
import { mapLessonHighlights } from './dcLessonHighlights.js';
import { lessonEquationTex } from './dcLessonMath.js';
import { parseDcQuestion } from './dcQuestions.js';
import { solveDcCircuit } from './dcSolver.js';
import { buildGraph } from './electricalGraph.js';
import { resolveDcMethod } from '../components/DcSolvePanel.jsx';

function lessonFor(payload = analysis, question = 'Solve using supernode analysis') {
  const graph = buildGraph(payload);
  const result = solveDcCircuit(graph);
  return { graph, result, lesson: buildDcLesson(graph, result, parseDcQuestion(question)) };
}

function takeStep(lesson, id = 'supernode-1') {
  return lesson.steps.find((step) => step.id === id);
}

function addSource(payload, id, positive, negative, value) {
  payload.components.push({ id, type: 'voltage_source', visible_value: `${value} V`, terminals: [{ label: '+' }, { label: '-' }] });
  payload.nodes.find((node) => node.id === positive).members.push(`${id}.+`);
  payload.nodes.find((node) => node.id === negative).members.push(`${id}.-`);
}

describe('supernode teaching in Nodal Analysis', () => {
  it.each(['Solve using supernode analysis.', 'Identify the supernodes.', 'Explain the supernode.', 'Why is a supernode needed?'])(
    'recognizes %s and explains a method conflict', (question) => {
      const intent = parseDcQuestion(question);
      expect(intent).toEqual({ kind: 'supernode', method: 'nodal' });
      expect(resolveDcMethod(intent, null)).toEqual({ method: 'nodal', conflict: null });
      expect(resolveDcMethod(intent, 'mesh').conflict).toMatch(/requests Nodal Analysis/);
      expect(resolveDcMethod(intent, 'reduction').conflict).toMatch(/requests Nodal Analysis/);
    },
  );

  it('writes signed boundary KCL and source constraints, with numeric substitutions and verified answers', () => {
    const { lesson, result } = lessonFor();
    const v1 = result.branches.find(({ componentId }) => componentId === 'V1');
    const step = takeStep(lesson);
    const [kcl, constraint] = step.equations;
    expect(new Set(step.supernodeNodeIds)).toEqual(new Set([v1.fromNodeId, v1.toNodeId]));
    expect(step.supernodeSourceIds).toEqual(['V1']);
    expect(step.currentArrowMode).toBe('reference');
    expect(step.branchIds).toEqual(['V1', 'R1', 'R2', 'R3', 'I1']);
    expect(kcl.terms.map(({ branchId, sign }) => [branchId, sign])).toEqual([['R1', -1], ['R2', 1], ['R3', 1], ['I1', -1]]);
    expect(constraint).toMatchObject({ fromNodeId: v1.fromNodeId, toNodeId: v1.toNodeId, equals: 4 });
    expect(lessonEquationTex(step.workedEquations[0], 'formula')).toContain('\\frac');
    expect(lessonEquationTex(step.workedEquations[0], 'substitution')).toContain('\\Omega');
    expect(lessonEquationTex(step.workedEquations[0], 'substitution')).toContain('- \\bigl(1\\,\\mathrm{A}\\bigr)');
    expect(lessonEquationTex(step.workedEquations[1], 'formula')).toContain('\\Delta V');
    expect(lessonEquationTex(step.workedEquations[1], 'substitution')).toContain('4\\,\\mathrm{V}');
    expect(takeStep(lesson, 'kcl')).toBeUndefined();
    expect(step.finalAnswer).toHaveLength(1);
    expect(takeStep(lesson, 'solve').workedEquations.some(({ kind }) => kind === 'nodal-potential')).toBe(true);
    expect(takeStep(lesson, 'constraints').equations.map(({ componentId }) => componentId)).toEqual(['V0']);
    expect(lesson.supernodes[0].kclResidual).toBeCloseTo(0, 12);
    expect(lesson.supernodes[0].sourceResiduals[0].residual).toBeCloseTo(0, 12);
    const final = takeStep(lesson, 'answer').finalAnswer;
    expect(final.find(({ id }) => id === v1.fromNodeId).value).toBeCloseTo(16 / 3, 12);
    expect(final.find(({ id }) => id === v1.toNodeId).value).toBeCloseTo(4 / 3, 12);
    expect(final.find(({ id }) => id === 'R3').value).toBeCloseTo(2 / 3, 12);
    expect(final.find(({ id }) => id === 'V1').value).toBeCloseTo(-1 / 3, 12);
    expect(takeStep(lesson, 'solve').branchFlows).toEqual(result.branches);
  });

  it.each([0, -2])('includes each extended-group constraint, including a reversed %s V source', (value) => {
    const payload = structuredClone(analysis);
    payload.nodes.push({ id: 'c', members: ['R4.A'] });
    payload.nodes.find(({ id }) => id === 'ground').members.push('R4.B');
    payload.components.push({ id: 'R4', type: 'resistor', visible_value: '2 ohm', terminals: [{ label: 'A' }, { label: 'B' }] });
    addSource(payload, 'V2', 'c', 'b', value);
    const { lesson, result } = lessonFor(payload, '');
    expect(lesson.supernodes).toHaveLength(1);
    const step = takeStep(lesson);
    expect(step.supernodeNodeIds).toHaveLength(3);
    expect(step.supernodeSourceIds).toEqual(['V1', 'V2']);
    const { fromNodeId, toNodeId } = result.branches.find(({ componentId }) => componentId === 'V2');
    expect(step.equations[2]).toMatchObject({ componentId: 'V2', fromNodeId, toNodeId, equals: value });
    expect(result.nodes.find(({ id }) => id === fromNodeId).voltage).toBeCloseTo(1 + 3 * value / 4, 12);
    expect(lesson.supernodes[0].kclResidual).toBeCloseTo(0, 12);
  });

  it('sums boundary terms between separate groups with opposite signs and excludes internal resistors', () => {
    const payload = structuredClone(analysis);
    payload.components.push(
      { id: 'R4', type: 'resistor', visible_value: '2 ohm', terminals: [{ label: 'A' }, { label: 'B' }] },
      { id: 'R5', type: 'resistor', visible_value: '2 ohm', terminals: [{ label: 'A' }, { label: 'B' }] },
    );
    payload.nodes.find(({ id }) => id === 'a').members.push('R4.A');
    payload.nodes.find(({ id }) => id === 'b').members.push('R4.B');
    payload.nodes.find(({ id }) => id === 'ground').members.push('R5.B');
    payload.nodes.push({ id: 'c', members: ['R5.A'] }, { id: 'd', members: [] });
    addSource(payload, 'V2', 'c', 'd', 2);
    payload.nodes.find(({ id }) => id === 'b').members = payload.nodes.find(({ id }) => id === 'b').members.filter((id) => id !== 'R3.A');
    payload.nodes.find(({ id }) => id === 'ground').members = payload.nodes.find(({ id }) => id === 'ground').members.filter((id) => id !== 'R3.B');
    payload.nodes.find(({ id }) => id === 'b').members.push('R3.B');
    payload.nodes.find(({ id }) => id === 'd').members.push('R3.A');
    const { lesson } = lessonFor(payload);
    expect(lesson.supernodes).toHaveLength(2);
    for (const group of lesson.supernodes) {
      expect(group.kclResidual).toBeCloseTo(0, 12);
      expect(group.terms.some(({ branchId }) => branchId === 'R4')).toBe(false);
      expect(group.terms.find(({ branchId }) => branchId === 'R3').sign).toBe(group.sources[0].componentId === 'V1' ? -1 : 1);
    }
  });

  it('uses ordinary nodal analysis when source constraints anchor a group to the reference', () => {
    const payload = structuredClone(analysis);
    addSource(payload, 'V2', 'a', 'supply', -2);
    const { lesson } = lessonFor(payload);
    expect(lesson.supernodes).toEqual([]);
    expect(lesson.noSupernodeMessage).toContain('Ordinary nodal analysis is sufficient');
    expect(lesson.steps.some(({ id }) => id.startsWith('supernode-'))).toBe(false);
    const constrained = lesson.steps.filter(({ id }) => id.startsWith('constraints'));
    expect(constrained.flatMap(({ equations }) => equations.map(({ componentId }) => componentId))).toEqual(['V0', 'V2', 'V1']);
    expect(lessonEquationTex(constrained[1].workedEquations[0], 'substitution')).toContain('8\\,\\mathrm{V}');
  });

  it.each([4, 5])('refuses to teach a dependent or inconsistent ideal source constraint at %s V', (value) => {
    const payload = structuredClone(analysis);
    addSource(payload, 'V2', 'a', 'b', value);
    const { lesson, result } = lessonFor(payload);
    expect(result.ok).toBe(false);
    expect(lesson).toMatchObject({ ok: false, steps: [] });
  });

  it('rejects a mismatched boundary balance even if source voltage differences still agree', () => {
    const { graph, result } = lessonFor();
    const v1 = result.branches.find(({ componentId }) => componentId === 'V1');
    const distorted = structuredClone(result);
    for (const node of distorted.nodes.filter(({ id }) => [v1.fromNodeId, v1.toNodeId].includes(id))) node.voltage += 1;
    expect(buildDcLesson(graph, distorted, parseDcQuestion('Explain the supernode'))).toMatchObject({ ok: false, steps: [] });
  });

  it('highlights verified member nodes, internal sources, and external branches without any outline', () => {
    const { graph, lesson } = lessonFor();
    const layout = layoutCircuit(analysis, graph);
    const step = takeStep(lesson);
    const focus = mapLessonHighlights(graph, layout, step);
    expect(new Set(focus.nodes.keys())).toEqual(new Set(step.supernodeNodeIds));
    expect([...focus.nodes.values()].every((role) => role === 'supernode')).toBe(true);
    expect(focus.supernodeSourceIds).toEqual(new Set(['V1']));
    expect(focus.componentIds).toEqual(new Set(['V1', 'R1', 'R2', 'R3', 'I1']));
    expect(focus.wireIds.size).toBeGreaterThan(0);
    expect(focus.meshBoundary).toBeUndefined();
    layout.nodes.find(({ id }) => step.supernodeNodeIds.includes(id)).members = ['unverified'];
    expect(mapLessonHighlights(graph, layout, step).supernodeSourceIds).toBeUndefined();
    expect(mapLessonHighlights(graph, layout, null).active).toBe(false);
  });
});
