import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import mixed from '../../tests/fixtures/dc_supernode_analysis.json';
import single from '../../tests/fixtures/sample_extracted_analysis.json';
import { buildGraph } from '../circuit/electricalGraph.js';
import { layoutCircuit } from '../circuit/circuitLayout.js';
import { solveDcSuperposition } from '../circuit/dcSuperposition.js';
import { buildDcSuperpositionLesson } from '../circuit/dcSuperpositionLesson.js';
import { lessonEquationTex } from '../circuit/dcLessonMath.js';
import { mapDcCurrentParticles } from '../circuit/dcCurrentParticles.js';
import { parseDcQuestion } from '../circuit/dcQuestions.js';
import { mapLessonHighlights } from '../circuit/dcLessonHighlights.js';
import DcSolvePanel, { DcSolveOutput, resolveDcMethod } from './DcSolvePanel.jsx';
import { DcLessonStepView } from './DcLessonSteps.jsx';
import CircuitDiagram from './CircuitDiagram.jsx';

function solve(payload, question = 'Solve using superposition') {
  const graph = buildGraph(payload);
  const result = solveDcSuperposition(graph);
  const lesson = buildDcSuperpositionLesson(result, parseDcQuestion(question), graph);
  return { graph, result, lesson };
}

const components = (parts) => parts.map(([id, type, visible_value, reverse]) => ({
  id, type, visible_value,
  terminals: (type === 'voltage_source' ? ['+', '-'] : ['A', 'B']).map((label) => ({ label })),
  ...(type === 'current_source' ? { currentDirection: { fromTerminal: reverse ? 'B' : 'A', toTerminal: reverse ? 'A' : 'B' } } : {}),
}));

const opposing = {
  contains_circuit: true,
  components: components([['V1', 'voltage_source', '12 V'], ['V2', 'voltage_source', '4 V'], ['R2', 'resistor', '4 ohm']]),
  nodes: [{ id: 'a', members: ['V1.+', 'R2.A'] }, { id: 'b', members: ['V2.+', 'R2.B'] }, { id: 'g', members: ['V1.-', 'V2.-'] }],
};

describe('interactive superposition', () => {
  it.each(['Solve using superposition.', 'Apply superposition theorem.', 'Find the contribution of each source.'])(
    'recognizes %s and handles a conflicting method selection', (question) => {
      const intent = parseDcQuestion(question);
      expect(intent).toEqual({ kind: 'superposition', method: 'superposition' });
      expect(resolveDcMethod(intent, 'nodal').conflict).toContain('requests Superposition Theorem');
      const graph = buildGraph(mixed);
      expect(renderToStaticMarkup(<DcSolvePanel graph={graph} questionText={question} />))
        .toContain('<option value="superposition" selected="">Superposition Theorem</option>');
    },
  );

  it('focuses the requested resistor, shows opposite signed contributions, and drives different particles', () => {
    const question = 'Find the current through R2 using superposition.';
    expect(parseDcQuestion(question)).toMatchObject({ kind: 'branch-current', target: 'R2', method: 'superposition' });
    const { graph, result, lesson } = solve(opposing, question);
    const [first, second, combined] = lesson.steps;
    expect(first.equations[0]).toMatchObject({ sourceId: 'V1', value: 3, branchVoltage: 12, resistance: 4 });
    expect(second.equations[0]).toMatchObject({ sourceId: 'V2', value: -1, branchVoltage: -4, resistance: 4 });
    expect(lessonEquationTex(second.equations[0], 'substitution')).toContain('\\frac{-4\\,\\mathrm{V}}{4\\,\\Omega}');
    expect(first.branchFlows).toBe(result.contributions[0].branches);
    expect(first.workedEquations.map(({ quantity }) => quantity)).toEqual(['voltage', 'current']);
    expect(first.caseDerivation.some(({ workedEquations }) => workedEquations?.some(({ kind }) => kind === 'source-constraint'))).toBe(true);
    expect(first.referenceNote).toContain('A → B');
    expect(second.branchFlows).toBe(result.contributions[1].branches);
    expect(combined.branchFlows).toBe(result.combined.branches);
    expect(combined.contributionTable.entries).toHaveLength(1);
    expect(combined.equations[0]).toMatchObject({ value: 2, directValue: 2, terms: [{ value: 3 }, { value: -1 }] });
    expect(lessonEquationTex(combined.equations[0], 'substitution')).toContain('\\bigl(-1\\,\\mathrm{A}\\bigr)');
    const layout = layoutCircuit(opposing, graph);
    const runs = lesson.steps.map((step) => mapDcCurrentParticles(graph, layout, step));
    expect(runs[0].length).toBeGreaterThan(0);
    expect(runs.every((step, i) => step.every(({ amperes }) => amperes === [3, 1, 2][i]))).toBe(true);
    expect(runs[1].find(({ nodeId }) => nodeId === runs[0][0].nodeId).points).toEqual([...runs[0][0].points].reverse());
    const markup = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={2} />);
    expect(markup).toContain('Signed source contributions');
    expect(markup).toContain('Direct MNA');
    expect(markup).not.toContain('Part A');
  });

  it('keeps case measurements aligned to MNA for a mixed network and renders actual shorts and opens', () => {
    const { graph, result, lesson } = solve(mixed);
    for (const [index, contribution] of result.contributions.entries()) {
      const step = lesson.steps[index];
      expect(step.sourceCase.active.componentId).toBe(contribution.activeSourceId);
      expect(step.equations).toHaveLength(contribution.nodes.length + contribution.branches.length);
      for (const equation of step.equations) {
        const expected = equation.quantity === 'node-voltage' ? contribution.nodes.find(({ id }) => id === equation.id).voltage
          : contribution.branches.find(({ componentId }) => componentId === equation.id).current;
        expect(equation.value).toBe(expected);
        expect(lessonEquationTex(equation)).toContain('\\approx');
      }
    }
    const step = lesson.steps.find(({ id }) => id === 'contribution-V0');
    const diagram = renderToStaticMarkup(<CircuitDiagram analysisResult={mixed} electricalGraph={graph} lessonStep={step} />);
    expect(diagram).toContain('Reconstructed circuit schematic');
    expect(diagram).toContain('Single-source circuit with V0 active');
    expect(diagram).toMatch(/data-case-component="V1" data-case-replacement="short"[^>]*><line/);
    expect(diagram).toMatch(/data-case-component="I1" data-case-replacement="open"[^>]*><g[^>]*><line[^>]*><\/line><line/);
    expect(diagram).toContain('data-comp-id="V0" data-superposition-source="active"');
    const states = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.indexOf(step)} />);
    expect(states).toContain('Ideal open (0 A)');
    expect(states).toContain('Ideal short (0 V)');
    expect(states).toContain('How this isolated circuit was solved');
    expect(step.finalAnswer).toHaveLength(1);
    expect(step.allResults.length + step.finalAnswer.length).toBe(step.equations.length);
    const layout = layoutCircuit(mixed, graph);
    expect(mapLessonHighlights(graph, layout, step).sourceStates).toEqual(new Map([['I1', 'open'], ['V0', 'active'], ['V1', 'short']]));
    const badStep = { ...step, sourceCase: { ...step.sourceCase, active: { ...step.sourceCase.active, fromNodeId: 'unverified' } } };
    expect(renderToStaticMarkup(<CircuitDiagram analysisResult={mixed} electricalGraph={graph} lessonStep={badStep} />))
      .toContain('This layout could not be verified for a separate circuit view');
  });

  it('computes power only on the final step and keeps the original source-supply sign convention', () => {
    const { lesson } = solve(opposing, 'Find the power dissipated by R2 using superposition');
    const total = lesson.steps.at(-1);
    expect(total.equations.at(-1)).toMatchObject({ kind: 'superposition-power', value: 16, voltage: 8, current: 2 });
    expect(lessonEquationTex(total.equations.at(-1), 'substitution')).toContain('\\bigl(8\\,\\mathrm{V}\\bigr)\\bigl(2\\,\\mathrm{A}\\bigr)');
    expect(lesson.steps.slice(0, -1).every(({ equations }) => equations.every(({ unit }) => unit !== 'W'))).toBe(true);
    const supply = solve(opposing, 'Current supplied by V2 using superposition').lesson.steps;
    expect(supply.at(-1).equations[0]).toMatchObject({ value: -2, terms: [{ value: -3 }, { value: 1 }] });
  });

  it('renders a zero-contribution case for opposing current sources and supports a single source', () => {
    const payload = { contains_circuit: true,
      components: components([['I1', 'current_source', '2 A'], ['I2', 'current_source', '500 mA', true], ['I3', 'current_source', '0 A'], ['R', 'resistor', '4 ohm']]),
      nodes: [{ id: 'a', members: ['I1.B', 'I2.B', 'I3.B', 'R.A'] }, { id: 'b', members: ['I1.A', 'I2.A', 'I3.A', 'R.B'] }],
    };
    const { graph, lesson } = solve(payload, 'Current through R using superposition');
    expect(lesson.steps.map(({ equations }) => equations[0].value)).toEqual([2, -0.5, 0, 1.5]);
    const zero = lesson.steps[2];
    expect(zero.currentDirections.every(({ effectivelyZero }) => effectivelyZero)).toBe(true);
    expect(mapDcCurrentParticles(graph, layoutCircuit(payload, graph), zero)).toEqual([]);
    const one = solve(single).lesson;
    expect(one.steps).toHaveLength(1);
    expect(one.steps[0].explanation).toContain('its contribution is the entire response');
    const singlePower = solve(single, 'Find the power dissipated by R1 using superposition');
    expect(singlePower.lesson.steps).toHaveLength(1);
    expect(singlePower.lesson.steps[0].primaryResult.value).toBe(36);
  });

  it('uses the verified branch contributions for a bridge with a nonzero cross branch', () => {
    const payload = { components: components([['V', 'voltage_source', '10 V'], ['I', 'current_source', '1 A'],
      ...[1, 2, 2, 1, 2].map((value, i) => [`R${i + 1}`, 'resistor', `${value} ohm`])]),
    nodes: [['V.+', 'R1.A', 'R2.A'], ['I.A', 'R1.B', 'R3.A', 'R5.A'], ['I.B', 'R2.B', 'R4.A', 'R5.B'], ['V.-', 'R3.B', 'R4.B']]
      .map((members, index) => ({ id: `group${index}`, members })),
    };
    const values = solve(payload, 'Current through R5 using superposition').lesson.steps.map(({ equations }) => equations[0].value);
    expect(values[0]).toBeCloseTo(-0.4, 11);
    expect(values[1]).toBeCloseTo(1, 11);
    expect(values[2]).toBeCloseTo(0.6, 11);
  });

  it('clears stale lessons under edits or method conflicts and displays nested solver failures', () => {
    const { graph, result } = solve(mixed);
    const render = (props) => renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} {...props} />);
    const questionText = 'Current through R2 using superposition';
    const { lesson } = solve(mixed, questionText);
    expect(render({ questionText })).not.toContain('Current through R2: 2.6667 A');
    const combined = lesson.steps.at(-1);
    expect(combined.finalAnswer[0].value).toBeCloseTo(8 / 3, 12);
    expect(render({ hasDraft: true })).not.toContain('Step-by-Step Solution');
    expect(render({ questionText: 'Current through R2 using mesh analysis' })).toContain('requests Mesh Analysis');
    const invalid = solve({ components: components([['V1', 'voltage_source', '5 V'], ['V2', 'voltage_source', '3 V']]),
      nodes: [{ id: 'p', members: ['V1.+', 'V2.+'] }, { id: 'n', members: ['V1.-', 'V2.-'] }] });
    const failure = render({ result: invalid.result });
    expect(failure).toContain('source constraints and current balances are inconsistent');
    expect(failure).not.toContain('Step-by-Step Solution');
    expect(invalid.lesson).toBeNull();
  });
});
