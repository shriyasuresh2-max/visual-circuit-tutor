import { describe, expect, it } from 'vitest';
import analysis from '../../tests/fixtures/dc_supernode_analysis.json';
import { buildGraph, termKey } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { transformDcSources } from './dcSourceTransformation.js';
import { parseDcQuestion } from './dcQuestions.js';
import { buildDcSourceTransformationLesson } from './dcSourceTransformationLesson.js';
import { lessonEquationTex } from './dcLessonMath.js';
import { layoutCircuit } from './circuitLayout.js';
import { mapLessonHighlights } from './dcLessonHighlights.js';

const fixture = () => buildGraph(analysis);

function graphFromBranches(branches) {
  const nodes = new Map();
  const components = branches.map(({ id, from, to, type, kind, value }) => {
    const terminals = [{ ...from }, { ...to }];
    for (const terminal of terminals) {
      if (!nodes.has(terminal.node)) nodes.set(terminal.node, []);
      nodes.get(terminal.node).push(termKey(id, terminal.label));
    }
    return { id, type, value, terminals, ...(kind === 'current' ? { currentDirection: { fromTerminal: from.label, toTerminal: to.label } } : {}) };
  });
  return { components, nodes: [...nodes].map(([id, members]) => ({ id, members })) };
}

describe('source transformation', () => {
  it('transforms both source forms in a larger graph in stable order and preserves every untouched branch', () => {
    const graph = fixture();
    const before = structuredClone(graph);
    const result = transformDcSources(graph);
    expect(result).toMatchObject({ ok: true, status: 'partial', verification: { status: 'verified' } });
    expect(graph).toEqual(before);
    expect(result.steps.map(({ direction, originalComponentIds, equivalent }) =>
      [direction, originalComponentIds, equivalent.source.value])).toEqual([
      ['current-to-voltage', ['I1', 'R3'], 2],
      ['voltage-to-current', ['V0', 'R1'], 5],
    ]);
    expect(result.issues.map(({ componentId }) => componentId)).toEqual(['V1']);
    const reversed = transformDcSources({ ...graph, components: [...graph.components].reverse(), nodes: [...graph.nodes].reverse() });
    expect(reversed.steps).toEqual(result.steps);
    expect(reversed.transformedGraph).toEqual(result.transformedGraph);
    expect(result.reductions.some(({ operation, equivalentResistance }) => operation === 'parallel' && equivalentResistance === 1)).toBe(true);
    const unchanged = result.verification.transformed.branches.find(({ componentId }) => componentId === 'R2');
    expect(unchanged.current).toBeCloseTo(8 / 3, 12);
    const original = result.originalResult.branches;
    expect(original.find(({ componentId }) => componentId === 'R3').current).toBeCloseTo(2 / 3, 12);
    expect(original.find(({ componentId }) => componentId === 'R1').current).toBeCloseTo(7 / 3, 12);
    expect(result.transformedGraph.components.some(({ id }) => id === 'R1')).toBe(false);
    expect(result.transformedGraph.nodes.some(({ id }) => id === result.steps[1].original.internalNodeId)).toBe(false);
  });

  it.each([
    ['voltage', 10, false], ['voltage', -10, true], ['voltage', 0, true], ['voltage', 10, true],
    ['current', 1.5, false], ['current', -1.5, true], ['current', 0, true], ['current', 1.5, true],
  ])('matches signed port behavior under loads for a %s source of %s with reversed orientation %s', (direction, value, reverse) => {
    const extraction = structuredClone(analysis);
    const target = direction === 'current' ? 'I1' : 'V0';
    const source = extraction.components.find(({ id }) => id === target);
    source.visible_value = `${value} ${direction === 'current' ? 'A' : 'V'}`;
    if (reverse && direction === 'current') source.currentDirection = { fromTerminal: 'A', toTerminal: 'B' };
    if (reverse && direction === 'voltage') {
      for (const node of extraction.nodes) node.members = node.members.map((key) => key === 'V0.+' ? 'V0.-' : key === 'V0.-' ? 'V0.+' : key);
    }
    const result = transformDcSources(buildGraph(extraction), { direction, target });
    const [step] = result.steps;
    const { a, b, original, equivalent, terminalBehavior } = step;
    expect(result.verification.status).toBe('verified');
    expect(equivalent.source.value).toBe(direction === 'current' ? value * 2 : value / 2);
    const originalSource = original.source;
    expect(direction === 'current' ? originalSource.from.label : originalSource.from.node === a)
      .toBe(direction === 'current' ? reverse ? 'A' : 'B' : reverse);

    const open = direction === 'voltage' ? value : value * 2;
    const short = direction === 'voltage' ? value / 2 : value;
    expect(terminalBehavior.original).toEqual({ openVoltage: open, shortCurrent: short });
    expect(terminalBehavior.transformed).toEqual(terminalBehavior.original);

    for (const pair of [original, equivalent]) {
      // Independently solve both forms against a load, including an ideal short.
      for (const load of [0, 1, 7]) {
        const branch = { id: 'TestLoad', value: load, type: load ? 'resistor' : 'voltage_source',
          from: { node: a, label: load ? 'A' : '+' }, to: { node: b, label: load ? 'B' : '−' } };
        const solved = solveDcCircuit(graphFromBranches([pair.source, pair.resistor, branch]), { referenceNodeId: b });
        expect(solved.ok).toBe(true);
        const measured = solved.branches.find(({ componentId }) => componentId === 'TestLoad');
        expect(measured.current).toBeCloseTo(open / (2 + load), 11);
        expect(measured.voltage).toBeCloseTo(open * load / (2 + load), 11);
      }
      // An unloaded series pair carries zero current; the existing graph
      // validator rejects open terminal nodes so use its constitutive law.
      if (pair.source.kind === 'voltage') expect(pair.source.value - 2 * 0).toBeCloseTo(open, 11);
      else {
        const solved = solveDcCircuit(graphFromBranches([pair.source, pair.resistor]), { referenceNodeId: b });
        expect(solved.nodes.find(({ id }) => id === a).voltage).toBeCloseTo(open, 11);
      }
    }
  });

  it('rejects branching junctions, ideal sources without matching resistors, ambiguous and invalid values', () => {
    const graph = fixture();
    expect(transformDcSources(graph, { target: 'V1' })).toMatchObject({ ok: false, status: 'unsupported', issues: [{ code: 'no-valid-pair' }] });
    expect(transformDcSources(graph, { target: 'UNKNOWN' }).issues[0].code).toBe('no-matching-source');
    expect(transformDcSources({ ...graph, incomplete: true }).issues[0].code).toBe('incomplete-connectivity');
    const invalid = structuredClone(graph);
    invalid.components.find(({ id }) => id === 'R1').valueRaw = '0 ohms';
    expect(transformDcSources(invalid)).toMatchObject({ ok: false, status: 'invalid', issues: [{ code: 'invalid-resistance' }] });
    const unsafe = structuredClone(graph);
    unsafe.components.find(({ id }) => id === 'R1').valueRaw = '1e-200 ohms';
    unsafe.components.find(({ id }) => id === 'V0').valueRaw = '1e200 V';
    expect(transformDcSources(unsafe, { target: 'V0' }).issues[0].code).toBe('numerical-range');
  });

  it('never reuses a generated branch as an original or invents a match for synonymous terminal positions', () => {
    const graph = fixture();
    const port = transformDcSources(graph, { target: 'I1' }).steps[0];
    const isolated = graphFromBranches([port.equivalent.source, port.equivalent.resistor,
      { id: 'Different', type: 'voltage_source', value: 0, from: { node: port.a, label: '+' }, to: { node: port.b, label: '−' } }]);
    expect(transformDcSources(isolated).steps).toHaveLength(1);
    const resistor = graphFromBranches([port.original.resistor,
      { id: 'Voltage', type: 'voltage_source', value: 4, from: { node: port.a, label: '+' }, to: { node: port.b, label: '−' } }]);
    expect(transformDcSources(resistor)).toMatchObject({ ok: false, status: 'unsupported' });
  });

  it('teaches the verified local relationship for an unloaded pair and keeps the original results separate', () => {
    const port = transformDcSources(fixture(), { target: 'I1' }).steps[0];
    const graph = graphFromBranches([port.original.source, port.original.resistor]);
    const result = transformDcSources(graph);
    expect(result).toMatchObject({ ok: true, status: 'partial', originalResult: { ok: true }, verification: { status: 'unavailable' } });
    expect(buildDcSourceTransformationLesson(graph, result, {}).steps.map(({ id }) => id))
      .toEqual([result.steps[0].id, 'transformation-limits', 'transformation-original-results']);
  });

  it.each([
    ['Solve using source transformation.', {}], ['Transform this voltage source.', { direction: 'voltage' }],
    ['Find the equivalent current source.', { direction: 'voltage' }], ['Find the equivalent voltage source.', { direction: 'current' }],
    ['Transform current source I1.', { direction: 'current', target: 'I1' }],
  ])('recognizes %s', (prompt, intent) => {
    expect(parseDcQuestion(prompt)).toEqual({ kind: 'source-transformation', method: 'transformation', ...intent });
  });

  it('uses the exact signed substitution, only original highlight IDs, and original flows on the final step', () => {
    const graph = fixture();
    const result = transformDcSources(graph, { target: 'V0' });
    const { steps: [step, ...rest] } = buildDcSourceTransformationLesson(graph, result, {});
    expect(step.componentIds).toEqual(['V0', 'R1']);
    const focus = mapLessonHighlights(graph, layoutCircuit(analysis, graph), step);
    expect(focus.componentIds).toEqual(new Set(['V0', 'R1']));
    expect(lessonEquationTex(step.equations[0], 'substitution')).toContain('\\frac{10\\,\\mathrm{V}}{2\\,\\Omega}');
    expect(lessonEquationTex(step.equations[1], 'formula')).toContain('I_{\\mathrm{out}}');
    expect(lessonEquationTex(step.equations[1], 'result')).toContain('5\\,\\mathrm{A}');
    expect(step.branchFlows).toBeUndefined();
    expect(rest.at(-1).branchFlows).toEqual(result.originalResult.branches);
  });

  it.each([
    ['Transform current source I1', ['current-to-voltage'], 0, 1],
    ['Transform voltage source V0', ['voltage-to-current'], 1, 2],
    ['Solve using source transformation', ['current-to-voltage', 'voltage-to-current'], 1, 5],
  ])('uses the actual transformations, reductions, and requested work for %s', (question, directions, reductions, count) => {
    const graph = fixture();
    const intent = parseDcQuestion(question);
    const result = transformDcSources(graph, intent);
    const lesson = buildDcSourceTransformationLesson(graph, result, intent);
    expect(lesson.steps).toHaveLength(count);
    const pairs = lesson.steps.filter(({ sourceIllustration }) => sourceIllustration);
    expect(pairs.map(({ sourceIllustration }) => sourceIllustration.direction)).toEqual(directions);
    for (const step of pairs) {
      const { original, equivalent, terminalBehavior } = step.sourceIllustration;
      const [value, port, resistance] = step.workedEquations;
      expect(value.value).toBeCloseTo(original.source.kind === 'voltage'
        ? original.source.value / original.resistor.value : original.source.value * original.resistor.value, 12);
      expect(port.openVoltage).toBe(terminalBehavior.transformed.openVoltage);
      expect(port.shortCurrent).toBe(terminalBehavior.transformed.shortCurrent);
      expect(resistance.value).toBe(equivalent.resistor.value);
      expect(lessonEquationTex(resistance, 'result')).toContain('2\\,\\Omega');
      expect(step.componentIds).toEqual([original.source.id, original.resistor.id]);
    }
    expect(lesson.steps.filter(({ illustration }) => illustration)).toHaveLength(reductions);
    expect(lesson.steps.at(-1).allResults).toHaveLength(result.originalResult.branches.length);
  });

  it.each([['R1', true, 7 / 3], ['R3', false, 2 / 3]])(
    'reconstructs original %s from the transformed port without copying internal equivalent branch values', (id, series, expected) => {
      const graph = fixture();
      const result = transformDcSources(graph);
      const lesson = buildDcSourceTransformationLesson(graph, result, parseDcQuestion(`Current through ${id}`));
      const step = lesson.steps.at(-1);
      expect(step.title).toBe(`Recover ${id} in the original circuit`);
      const [port, drop, current] = step.workedEquations;
      expect(drop.series).toBe(series);
      expect(port.portVoltage).toBeCloseTo(port.va - port.vb, 12);
      expect(current.current).toBeCloseTo(expected, 12);
      expect(current.current).toBeCloseTo(drop.sign * (series ? drop.openVoltage - port.portVoltage : port.portVoltage) / drop.resistance, 12);
      expect(lessonEquationTex(drop, 'substitution')).toContain('\\mathrm{V}');
      expect(lessonEquationTex(current, 'substitution')).toContain('\\frac');
      expect(step.primaryResult).toBe(current);
      const pair = result.steps.find(({ original }) => original.resistor.id === id);
      expect(result.verification.transformed.branches.find(({ componentId }) => componentId === pair.equivalent.resistor.id).current)
        .not.toBeCloseTo(expected, 12);
      expect(step.branchFlows).toEqual(result.originalResult.branches);
      expect(step.componentIds).toEqual([id]);
    },
  );

  it('explains negative values against the verified references and withholds unsupported lessons', () => {
    const opposite = structuredClone(analysis);
    for (const [id, value] of [['V0', '-10 V'], ['I1', '-1 A']]) opposite.components.find((part) => part.id === id).visible_value = value;
    const graph = buildGraph(opposite);
    const result = transformDcSources(graph);
    const lesson = buildDcSourceTransformationLesson(graph, result);
    expect(lesson.steps.filter(({ sourceIllustration }) => sourceIllustration).map(({ sourceNote }) => sourceNote))
      .toEqual([expect.stringContaining('A lower than B'), expect.stringContaining('flows from A to B')]);
    expect(lesson.steps.find(({ id }) => id === 'transformation-limits').transformationIssues).toHaveLength(1);
    expect(buildDcSourceTransformationLesson(graph, transformDcSources(graph, { target: 'V1' }))).toBeNull();
  });
});
