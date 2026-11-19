import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { parseDcQuestion } from './dcQuestions.js';
import { buildDcLesson } from './dcLesson.js';

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

      const kcl = step(lesson, 'kcl').equations;
      expect(kcl.map(({ nodeId }) => nodeId)).toEqual(result.nodes
        .filter(({ id }) => id !== result.referenceNodeId).map(({ id }) => id));
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
      expect(step(lesson, 'substitute').equations.every((equation) => equation.substituted)).toBe(true);
      expect(step(lesson, 'substitute').equations.some((equation) =>
        equation.expression.includes('Ω') && equation.expression.includes('0 V'))).toBe(true);
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
      .toMatchObject({ ok: false, message: expect.stringMatching(/method is unavailable/), steps: [] });
    const intent = parseDcQuestion('Current through X');
    expect(buildDcLesson(network, { ok: false }, intent)).toMatchObject({ ok: false, steps: [] });
    expect(buildDcLesson({ ...network, incomplete: true }, result, intent)).toMatchObject({ ok: false, steps: [] });
    const mismatched = structuredClone(network);
    mismatched.components[0].terminals[0].node = result.referenceNodeId;
    expect(buildDcLesson(mismatched, result, intent)).toMatchObject({ ok: false, steps: [] });
  });
});
