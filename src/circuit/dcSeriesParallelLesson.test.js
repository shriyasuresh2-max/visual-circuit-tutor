import { describe, expect, it } from 'vitest';
import mixed from '../../tests/fixtures/mixed_return_trace_analysis.json';
import sourceNetwork from '../../tests/fixtures/dc_mesh_tutor_analysis.json';
import { buildGraph } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { solveDcSeriesParallel } from './dcSeriesParallelSolver.js';
import { solveDcCircuit } from './dcSolver.js';
import { buildDcSeriesParallelLesson } from './dcSeriesParallelLesson.js';
import { mapLessonHighlights } from './dcLessonHighlights.js';
import { lessonEquationTex } from './dcLessonMath.js';
import { mapDcCurrentParticles } from './dcCurrentParticles.js';
import { parseDcQuestion } from './dcQuestions.js';

function solve(analysis) {
  const graph = buildGraph(analysis);
  const result = solveDcSeriesParallel(graph);
  return { graph, result, lesson: buildDcSeriesParallelLesson(result) };
}

const circuit = (branches) => {
  const groups = new Map();
  const components = branches.map(([id, a, b, visible_value]) => {
    const supply = id === 'V';
    const labels = supply ? ['+', '-'] : ['A', 'B'];
    for (const [node, label] of [[a, labels[0]], [b, labels[1]]]) {
      if (!groups.has(node)) groups.set(node, []);
      groups.get(node).push(`${id}.${label}`);
    }
    return { id, type: supply ? 'voltage_source' : 'resistor', visible_value,
      terminals: labels.map((label) => ({ label })) };
  });
  return { components, nodes: [...groups].map(([id, members]) => ({ id, members })) };
};

describe('series-parallel lessons', () => {
  it('uses a series sum and a parallel reciprocal sum with the supplied values', () => {
    const series = solve(circuit([['V', 'a', 'g', '12 V'], ['R1', 'a', 'b', '4 ohm'], ['R2', 'b', 'g', '2 ohm']]));
    const parallel = solve(circuit([['V', 'a', 'g', '12 V'], ['R1', 'a', 'g', '4 ohm'], ['R2', 'a', 'g', '4 ohm']]));
    const seriesEquation = series.lesson.steps[0].equations[0];
    expect(lessonEquationTex(seriesEquation, 'formula')).toContain('R_{1} + R_{2}');
    expect(lessonEquationTex(seriesEquation, 'substitution')).toContain('4\\,\\Omega + 2\\,\\Omega');
    expect(lessonEquationTex(seriesEquation)).toContain('6\\,\\Omega');
    const parallelEquation = parallel.lesson.steps[0].equations[0];
    expect(lessonEquationTex(parallelEquation, 'formula')).toContain('\\frac{1}{\\frac{1}{R_{1}} + \\frac{1}{R_{2}}}');
    expect(lessonEquationTex(parallelEquation, 'substitution')).toContain('\\frac{1}{4\\,\\Omega}');
    expect(lessonEquationTex(parallelEquation)).toContain('2\\,\\Omega');
  });

  it('teaches nested groups, signs, source current, and each original resistor result', () => {
    const { result, lesson } = solve(mixed);
    expect(result.equivalentResistance).toBe(7);
    const second = lesson.steps[1];
    expect(lessonEquationTex(second.equations[0], 'formula')).toContain('R_{\\mathrm{eq},1}');
    const source = lesson.steps.find(({ id }) => id === 'source-current');
    const supply = source.equations.find(({ kind }) => kind === 'reduction-source');
    expect(lessonEquationTex(supply, 'substitution')).toContain('18\\,\\mathrm{V}');
    expect(supply.value).toBeCloseTo(-18 / 7);
    const back = lesson.steps.filter(({ id }) => id.startsWith('restore-'));
    expect(back.map(({ equations: [equation] }) => equation.operation)).toEqual(['series', 'parallel']);
    expect(back.flatMap(({ equations }) => equations).some(({ sign }) => sign === -1)).toBe(true);
    const final = lesson.steps.at(-1);
    expect(final.currentArrowMode).toBe('actual');
    for (const equation of final.allResults) {
      expect(result.branches.find(({ componentId }) => componentId === equation.componentId)).toMatchObject({
        voltage: equation.voltage, current: equation.current, power: equation.power,
      });
      const maths = lessonEquationTex(equation);
      for (const unit of ['V', 'A', 'W']) expect(maths).toContain(`\\mathrm{${unit}}`);
    }
  });

  it('highlights the original group and its verified terminals without highlighting unrelated wires', () => {
    const { graph, lesson } = solve(mixed);
    const layout = layoutCircuit(mixed, graph);
    const [parallel, series] = lesson.steps;
    expect(parallel.illustration).toMatchObject({ equivalentIndex: 1 });
    expect(series.componentIds.sort()).toEqual(['R1', 'R2', 'R3']);
    const highlight = mapLessonHighlights(graph, layout, parallel);
    expect(highlight.componentIds).toEqual(new Set(['R2', 'R3']));
    expect(highlight.terminalKeys).toEqual(new Set(['R2.A', 'R2.B', 'R3.A', 'R3.B']));
    expect(highlight.wireIds.size).toBe(0);
    const altered = {
      ...layout, components: layout.components.map((component) => component.id === 'R2'
        ? { ...component, terminals: component.terminals.map((terminal) => ({ ...terminal, node: 'unknown' })) }
        : component),
    };
    expect(mapLessonHighlights(graph, altered, parallel).terminalKeys).toEqual(new Set(['R3.A', 'R3.B']));
  });

  it('teaches local reductions without a total on branched bridges and mixed-source circuits', () => {
    const bridge = circuit([
      ['V', 'a', 'g', '10 V'], ['R1', 'a', 'b', '1 ohm'], ['R2', 'a', 'c', '2 ohm'],
      ['R3', 'b', 'g', '2 ohm'], ['R4', 'c', 'g', '1 ohm'], ['R5', 'b', 'c', '2 ohm'],
      ['R6', 'a', 'b', '3 ohm'],
    ]);
    for (const analysis of [bridge, sourceNetwork]) {
      const { result, lesson } = solve(analysis);
      expect(result.status).toBe('partial');
      expect(lesson.steps[0].equations[0].kind).toBe('reduction-group');
      expect(lesson.steps.at(-1)).toMatchObject({ id: 'partial', equations: [] });
      expect(lesson.steps).toHaveLength(result.steps.length + 1);
      expect(lesson.steps.at(-1).remainingNetwork.map(({ name, ...branch }) => branch)).toEqual(result.remainingGraph.branches);
      expect(lesson.steps.every(({ branchFlows }) => !branchFlows)).toBe(true);
    }
    const noExtraBranch = { ...bridge,
      components: bridge.components.filter(({ id }) => id !== 'R6'),
      nodes: bridge.nodes.map((node) => ({ ...node, members: node.members.filter((member) => !member.startsWith('R6.')) })),
    };
    expect(solve(noExtraBranch)).toMatchObject({ result: { status: 'unsupported' }, lesson: null });
    expect(solve(circuit([['V', 'a', 'a', '3 V'], ['R1', 'a', 'a', '2 Ω']])))
      .toMatchObject({ result: { status: 'invalid' }, lesson: null });
  });

  it.each([
    ['series', circuit([['V', 'a', 'g', '12 V'], ['R1', 'a', 'b', '4 ohm'], ['R2', 'b', 'g', '2 ohm']]), 3],
    ['parallel', circuit([['V', 'a', 'g', '12 V'], ['R1', 'a', 'g', '4 ohm'], ['R2', 'g', 'a', '4 ohm']]), 3],
    ['mixed', mixed, 5],
    ['nested', circuit([['V', 'a', 'g', '-12 V'], ['R1', 'a', 'b', '6 ohm'], ['R2', 'b', 'a', '3 ohm'],
      ['R3', 'b', 'c', '4 ohm'], ['R4', 'b', 'c', '4 ohm'], ['R5', 'c', 'g', '2 ohm']]), 9],
    ['single load', circuit([['V', 'a', 'g', '12 V'], ['R1', 'g', 'a', '4 ohm']]), 1],
  ])('works every operation in a %s circuit and agrees with MNA', (_, analysis, count) => {
    const { graph, result, lesson } = solve(analysis);
    const mna = solveDcCircuit(graph);
    expect(mna.ok).toBe(true);
    expect(lesson.steps).toHaveLength(count);
    const reductions = lesson.steps.slice(0, result.steps.length);
    for (const [index, { equations: [e], componentIds, illustration }] of reductions.entries()) {
      const values = e.terms.map(({ resistance }) => resistance);
      expect(e.value).toBeCloseTo(e.operation === 'series' ? values.reduce((a, b) => a + b, 0)
        : 1 / values.reduce((sum, resistance) => sum + 1 / resistance, 0), 12);
      expect(componentIds).toEqual(result.steps[index].originalComponentIds);
      expect(illustration).toMatchObject({ equivalentIndex: index + 1, resistance: e.value });
    }
    const source = lesson.steps[result.steps.length];
    const [total, supply, load] = source.equations;
    expect(supply.value).toBeCloseTo(-supply.voltage / total.value, 12);
    expect(load.current).toBeCloseTo(-load.sign * supply.value, 12);
    expect(load.voltage).toBeCloseTo(load.sign * supply.voltage, 12);
    const branches = new Map([[load.load.id, load]]);
    const restore = lesson.steps.slice(result.steps.length + 1);
    expect(restore.map(({ id }) => id)).toEqual(result.steps.toReversed().map(({ id }) => `restore-${id}`));
    for (const { equations } of restore) {
      for (const step of equations) {
        const parent = branches.get(step.parent.id);
        if (step.operation === 'series') {
          expect(step.current).toBeCloseTo(step.sign * parent.current, 12);
          expect(step.voltage).toBeCloseTo(step.current * step.resistance, 12);
        } else {
          expect(step.voltage).toBeCloseTo(step.sign * parent.voltage, 12);
          expect(step.current).toBeCloseTo(step.voltage / step.resistance, 12);
        }
        for (const stage of ['formula', 'substitution', 'result']) expect(lessonEquationTex(step, stage)).toBeTruthy();
        branches.set(step.child.id, step);
      }
    }
    for (const solved of mna.branches) {
      const actual = branches.get(solved.componentId) ?? { current: supply.value, voltage: supply.voltage };
      expect(actual.current).toBeCloseTo(solved.current, 12);
      expect(actual.voltage).toBeCloseTo(solved.voltage, 12);
      const summary = lesson.steps.at(-1).allResults.find(({ componentId }) => componentId === solved.componentId);
      if (summary) expect(summary.power).toBeCloseTo(solved.voltage * solved.current, 12);
    }
  });

  it('works the requested value in its actual restoration and keeps the complete summary accessible', () => {
    const { result } = solve(mixed);
    const lesson = buildDcSeriesParallelLesson(result, parseDcQuestion('Power dissipated by R2'));
    const step = lesson.steps.find(({ primaryResult }) => primaryResult);
    expect(step.primaryResult).toMatchObject({ kind: 'resistor-power', value: expect.closeTo(6 * (12 / 7) ** 2, 12) });
    expect(step.equations.map(({ kind }) => kind)).toEqual(['reduction-sharing', 'reduction-sharing', 'resistor-power']);
    expect(lesson.steps.at(-1).allResults).toHaveLength(3);
  });

  it('restores zero-current branches without animating them', () => {
    const analysis = { ...mixed, components: mixed.components.map((component) => component.id === 'V1'
      ? { ...component, visible_value: '0 V' } : component) };
    const { graph, lesson } = solve(analysis);
    const layout = layoutCircuit(analysis, graph);
    const step = lesson.steps.at(-1);
    expect(step.currentDirections.every(({ effectivelyZero }) => effectivelyZero)).toBe(true);
    expect(mapDcCurrentParticles(graph, layout, step)).toEqual([]);
  });
});
