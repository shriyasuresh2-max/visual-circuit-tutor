import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { parseDcQuestion } from './dcQuestions.js';
import { buildDcLesson } from './dcLesson.js';
import { lessonEquationTex } from './dcLessonMath.js';

function graph(parts, groups, extra = {}) {
  return buildGraph({
    components: parts.map(([id, visible_value, type = 'resistor']) => ({
      id, visible_value, type,
      terminals: (type === 'resistor' ? ['A', 'B'] : ['+', '−']).map((label) => ({ label })),
    })),
    nodes: groups.map((members, i) => ({ id: `group${i}`, members })),
    ...extra,
  });
}

const bridge = () => graph(
  [['E', '10 V', 'battery'], ['P', '1 Ω'], ['Q', '2 Ω'], ['R', '2 Ω'], ['T', '1 Ω'], ['X', '2 Ω']],
  [['E.+', 'P.A', 'Q.A'], ['E.−', 'R.B', 'T.B'], ['P.B', 'R.A', 'X.A'], ['Q.B', 'T.A', 'X.B']],
);
const stackedSources = () => graph(
  [['E1', '8 V', 'battery'], ['E2', '4 V', 'voltage_source'], ['P', '6 Ω'], ['Q', '4 Ω']],
  [['E1.−', 'P.B', 'Q.B'], ['E1.+', 'E2.−', 'Q.A'], ['E2.+', 'P.A']],
);
const step = (lesson, id) => lesson.steps.find((entry) => entry.id === id);
const readTerm = (term, potentials, sourceCurrent) => term.sign * (term.resistance == null
  ? sourceCurrent.get(term.branchId)
  : (potentials.get(term.fromNodeId) - potentials.get(term.toNodeId)) / term.resistance);

describe('buildDcLesson', () => {
  it.each([['unbalanced bridge', bridge], ['stacked sources', stackedSources]])(
    'reproduces the MNA equations and electrical identities for a %s',
    (_name, fixture) => {
      const network = fixture();
      const result = solveDcCircuit(network);
      const lesson = buildDcLesson(network, result, parseDcQuestion('General nodal analysis'));
      expect(lesson.ok).toBe(true);
      expect(lesson.method).toBe('modified-nodal-analysis');
      expect(new Set(lesson.steps.map(({ id }) => id)).size).toBe(lesson.steps.length);
      const potentials = new Map(result.nodes.map(({ id, voltage }) => [id, voltage]));
      const sourceCurrent = new Map(result.branches.filter((branch) => branch.sourceVoltage != null)
        .map(({ componentId, current }) => [componentId, current]));

      const kcl = lesson.steps.flatMap(({ equations }) => equations.filter(({ kind }) => kind === 'kcl'));
      const knownNodes = step(lesson, 'constraints').finalAnswer.map(({ id }) => id);
      expect(kcl.map(({ nodeId }) => nodeId)).toEqual(result.nodes
        .filter(({ id }) => id !== result.referenceNodeId && !knownNodes.includes(id)).map(({ id }) => id));
      for (const equation of kcl) {
        const expected = result.branches
          .filter(({ fromNodeId, toNodeId }) => fromNodeId !== toNodeId &&
            (fromNodeId === equation.nodeId || toNodeId === equation.nodeId));
        expect(equation.terms.map(({ branchId, sign }) => [branchId, sign])).toEqual(
          expected.map(({ componentId, fromNodeId }) => [componentId, fromNodeId === equation.nodeId ? 1 : -1]),
        );
        expect(equation.terms.reduce((sum, term) => sum + readTerm(term, potentials, sourceCurrent), 0))
          .toBeCloseTo(equation.equals, 11);
      }
      const constraints = step(lesson, 'constraints').equations;
      expect(constraints).toHaveLength(sourceCurrent.size);
      for (const rule of constraints) {
        expect(rule.fromTerminal).toBe('+');
        expect(rule.toTerminal).toBe('−');
        expect(potentials.get(rule.fromNodeId) - potentials.get(rule.toNodeId)).toBeCloseTo(rule.equals, 11);
      }
      expect(step(lesson, 'constraints').workedEquations.every(({ staged }) => staged)).toBe(true);
      for (const { workedEquations } of lesson.steps.filter(({ id }) => id.startsWith('kcl'))) {
        expect(workedEquations.every((equation) => lessonEquationTex(equation, 'substitution').includes('\\Omega'))).toBe(true);
      }
      const balances = lesson.steps.at(-1).equations.filter(({ kind }) => kind === 'nodal-source-current');
      expect(balances).toHaveLength(sourceCurrent.size);
      for (const equation of balances) {
        expect(equation.terms.reduce((sum, term) => sum + term.sign * term.value, 0)).toBeCloseTo(sourceCurrent.get(equation.id), 11);
      }
      for (const entry of lesson.steps) {
        expect(entry.nodeIds.every((id) => potentials.has(id))).toBe(true);
        expect(entry.branchIds).toEqual(entry.componentIds);
        expect(entry.wireIds).toEqual([]);
        for (const arrow of entry.currentDirections) {
          const component = network.components.find(({ id }) => id === arrow.componentId);
          expect(component.terminals).toContainEqual(expect.objectContaining({ label: arrow.fromTerminal, node: arrow.fromNodeId }));
          expect(component.terminals).toContainEqual(expect.objectContaining({ label: arrow.toTerminal, node: arrow.toNodeId }));
        }
      }
    },
  );

  it('adds only the steps needed for a fixed voltage, one unknown, and coupled equations', () => {
    const twoNodes = graph([['E', '12 V', 'battery'], ['R', '4 Ω']], [['E.+', 'R.A'], ['E.−', 'R.B']]);
    const series = graph([['E', '12 V', 'battery'], ['R1', '2 Ω'], ['R2', '4 Ω']],
      [['E.+', 'R1.A'], ['R1.B', 'R2.A'], ['E.−', 'R2.B']]);
    const lessons = [twoNodes, series, bridge()].map((network) => buildDcLesson(network, solveDcCircuit(network), parseDcQuestion('')));
    expect(lessons.map(({ steps }) => steps.length)).toEqual([3, 5, 7]);
    expect(lessons[0].steps[0].directionEquations).toHaveLength(2);
    const isolation = step(lessons[1], 'solve').equations[0];
    expect(isolation).toMatchObject({ kind: 'nodal-isolate', rhs: 6, coefficient: 0.75, value: 8 });
    const rows = step(lessons[2], 'collect').equations;
    const elimination = lessons[2].steps.find(({ id }) => id.startsWith('eliminate-')).equations[0];
    expect(elimination.terms).toHaveLength(1);
    expect(elimination.rhs).toBeCloseTo(rows[1].rhs - elimination.factor * rows[0].rhs, 12);
    for (const equation of step(lessons[2], 'solve').equations) {
      const numerator = equation.rhs - equation.terms.reduce((sum, term) => sum + term.coefficient * term.voltage, 0);
      expect(numerator / equation.coefficient).toBeCloseTo(equation.value, 12);
    }
  });

  it('teaches a passive network without source instructions or moving currents', () => {
    const passive = graph([['P', '2 Ω'], ['Q', '4 Ω']], [['P.A', 'Q.A'], ['P.B', 'Q.B']]);
    const lesson = buildDcLesson(passive, solveDcCircuit(passive), parseDcQuestion(''));
    expect(lesson.steps.map(({ id }) => id)).toEqual(['reference', 'kcl', 'solve', 'answer']);
    const end = lesson.steps.at(-1);
    expect(end.explanation).not.toContain('source');
    expect(end.finalAnswer.every(({ value }) => value === 0)).toBe(true);
    expect(end.currentDirections.every(({ effectivelyZero }) => effectivelyZero)).toBe(true);
  });

  it.each([
    ['Current through X', 'branch-current', 'A', 1],
    ['Voltage across X', 'resistor-voltage', 'V', 2],
    ['Power dissipated by X', 'resistor-power', 'W', 2],
    ['Current supplied by E', 'source-supply', 'A', 7],
  ])('produces only the requested final quantity for %s', (question, kind, unit, expected) => {
    const network = bridge();
    const result = solveDcCircuit(network);
    const lesson = buildDcLesson(network, result, parseDcQuestion(question));
    const final = step(lesson, 'answer');
    expect(final.finalAnswer).toHaveLength(1);
    const [answer] = final.finalAnswer;
    expect(answer).toMatchObject({ kind, unit });
    expect(answer.value).toBeCloseTo(expected, 11);
    expect(final.componentIds).toEqual([answer.id]);
    if (kind === 'source-supply') {
      expect(final.currentDirections[0]).toMatchObject({ fromTerminal: '−', toTerminal: '+' });
    }
  });

  it('returns the named node relative to the actual solver reference', () => {
    const network = bridge();
    const referenceNodeId = network.nodes.find(({ members }) => members.includes('E.+')).id;
    const result = solveDcCircuit(network, { referenceNodeId });
    const node = network.nodes.find(({ members }) => members.includes('X.A')).id;
    const lesson = buildDcLesson(network, result, parseDcQuestion(`Voltage at ${node}`));
    expect(step(lesson, 'reference').equations[0]).toMatchObject({ nodeId: referenceNodeId, value: 0 });
    const final = step(lesson, 'answer');
    expect(final.nodeIds).toEqual([node, referenceNodeId]);
    expect(final.finalAnswer[0].value).toBeCloseTo(-4, 11);
  });

  it('distinguishes assumed directions from signed solved currents and bridge roundoff', () => {
    const network = bridge();
    for (const component of network.components.filter(({ id }) => ['P', 'Q', 'R', 'T'].includes(id))) {
      Object.assign(component, { valueRaw: '100 Ω', value: '100 Ω' });
    }
    const result = solveDcCircuit(network);
    const lesson = buildDcLesson(network, result, parseDcQuestion('Current through X'));
    const reference = step(lesson, 'kcl');
    expect(reference.currentArrowMode).toBe('reference');
    expect(reference.currentDirections.find(({ branchId }) => branchId === 'X')).not.toHaveProperty('signedCurrent');
    const solved = step(lesson, 'solve');
    expect(solved.currentArrowMode).toBe('actual');
    expect(solved.currentDirections.find(({ branchId }) => branchId === 'E').signedCurrent).toBeLessThan(0);
    expect(solved.currentDirections.find(({ branchId }) => branchId === 'P').signedCurrent).toBeGreaterThan(0);
    expect(step(lesson, 'answer').currentDirections[0]).toMatchObject({ branchId: 'X', effectivelyZero: true });
  });

  it('refuses unsupported methods, unsuccessful solves and mismatched topology', () => {
    const network = bridge();
    const result = solveDcCircuit(network);
    expect(buildDcLesson(network, result, parseDcQuestion('Current through X using mesh analysis')))
      .toMatchObject({ ok: false, message: expect.stringMatching(/Select Mesh Analysis/), steps: [] });
    const intent = parseDcQuestion('Current through X');
    expect(buildDcLesson(network, { ok: false }, intent)).toMatchObject({ ok: false, steps: [] });
    expect(buildDcLesson({ ...network, incomplete: true }, result, intent)).toMatchObject({ ok: false, steps: [] });
    const mismatched = structuredClone(network);
    mismatched.components[0].terminals[0].node = result.referenceNodeId;
    expect(buildDcLesson(mismatched, result, intent)).toMatchObject({ ok: false, steps: [] });
  });
});
