import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildGraph } from '../circuit/electricalGraph.js';
import { layoutCircuit } from '../circuit/circuitLayout.js';
import { solveDcCircuit } from '../circuit/dcSolver.js';
import { solveDcMeshCircuit } from '../circuit/dcMeshSolver.js';
import { solveDcSuperposition } from '../circuit/dcSuperposition.js';
import { buildDcSuperpositionLesson } from '../circuit/dcSuperpositionLesson.js';
import { dcDisplayContext, displayEquation, displayNumber, displayQuantity, displayZero } from '../circuit/electricalDisplay.js';
import { valueDisplay } from '../circuit/componentValue.js';
import { parseDcQuestion } from '../circuit/dcQuestions.js';
import CircuitDiagram from './CircuitDiagram.jsx';
import { DcSolveOutput } from './DcSolvePanel.jsx';
import { DcLessonStepView } from './DcLessonSteps.jsx';
import { buildDcLesson } from '../circuit/dcLesson.js';
import { mapDcCurrentParticles } from '../circuit/dcCurrentParticles.js';

const component = (id, type, visible_value, labels) => ({ id, type, visible_value, terminals: labels.map((label) => ({ label })) });
const groups = (...members) => members.map((keys, index) => ({ id: `net${index}`, members: keys }));
const grounded = {
  contains_circuit: true,
  components: [component('V1', 'voltage_source', '5 V', ['+', '-']), component('R1', 'resistor', '2 ohm', ['A', 'B']),
    component('R2', 'resistor', '4 ohm', ['A', 'B']), component('G1', 'ground', null, ['A'])],
  nodes: groups(['V1.+', 'R1.A'], ['R1.B', 'R2.A', 'G1.A'], ['R2.B', 'V1.-']),
};
const balanced = {
  contains_circuit: true,
  components: [component('R1', 'resistor', '4 ohm', ['A', 'B']), component('V1', 'voltage_source', '12 V', ['+', '-']),
    component('R2', 'resistor', '6 ohm', ['A', 'B']),
    { ...component('I1', 'current_source', '2 A', ['A', 'B']), currentDirection: { fromTerminal: 'B', toTerminal: 'A' } }],
  nodes: groups(['R1.A', 'R2.A', 'I1.A'], ['R1.B', 'V1.+'], ['V1.-', 'R2.B', 'I1.B']),
};

describe('ground marker reconstruction', () => {
  it('preserves the single photo-evidenced terminal, selects its node as reference and leaves it out of the branch solve', () => {
    const graph = buildGraph(grounded);
    const ground = graph.components.find(({ id }) => id === 'G1');
    expect(ground.terminals).toEqual([{ label: 'A', node: graph.referenceNodeId, position: null }]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.incomplete).toBe(false);
    expect(graph.nodes.find(({ id }) => id === graph.referenceNodeId).members).toEqual(expect.arrayContaining(['R1.B', 'R2.A', 'G1.A']));
    const solved = solveDcCircuit(graph);
    expect(solved).toMatchObject({ ok: true, referenceNodeId: graph.referenceNodeId });
    expect(solved.branches).toHaveLength(3);
    expect(solveDcSuperposition(graph)).toMatchObject({ ok: true, referenceNodeId: graph.referenceNodeId });
    expect(solveDcMeshCircuit(graph)).toMatchObject({ ok: true, referenceNodeId: graph.referenceNodeId });
    const layout = layoutCircuit(grounded, graph);
    expect(layout.renderValidation.isValid).toBe(true);
    expect(layout.components.find(({ id }) => id === 'G1').terminals).toHaveLength(1);
    const lesson = buildDcLesson(graph, solved, parseDcQuestion('Current through R2'));
    const markup = renderToStaticMarkup(<CircuitDiagram analysisResult={grounded} electricalGraph={graph} lessonStep={lesson.steps.at(-1)} />);
    expect(markup).toContain('data-comp-id="G1"');
    expect(markup).toContain('class="dc-current-flow"');
    expect(markup).toMatch(/class="dc-current-flow"[^>]*stroke-width="1\.8"[^>]*vector-effect="non-scaling-stroke"/);
  });

  it('preserves real orphan errors when a lone terminal touches only a marker', () => {
    const graph = buildGraph({ ...grounded,
      nodes: groups(['V1.+', 'R1.A'], ['G1.A', 'R1.B'], ['R2.A'], ['R2.B', 'V1.-']),
    });
    expect(graph.incomplete).toBe(true);
    expect(graph.validation.warnings.some((warning) => warning.includes('R1.B (possible orphan)'))).toBe(true);
    expect(solveDcCircuit(graph).ok).toBe(false);
  });

  it('keeps separate node references and flags contradictory second terminals', () => {
    const separate = buildGraph({ ...grounded, components: [...grounded.components, component('G2', 'ground', null, ['A'])],
      nodes: groups(['V1.+', 'R1.A'], ['R1.B', 'R2.A', 'G1.A'], ['R2.B', 'V1.-', 'G2.A']) });
    expect(separate.nodes).toHaveLength(3);
    expect(separate.referenceNodeId).toBeUndefined();
    const invalid = buildGraph({ ...grounded, components: grounded.components.map((part) => part.id === 'G1'
      ? component('G1', 'ground', null, ['A', 'B']) : part) });
    expect(invalid.validation.errors[0]).toContain('multiple reported terminals');
    expect(invalid.incomplete).toBe(true);
  });
});

describe('display precision', () => {
  it('suppresses roundoff using a local scale while retaining real small, negative and prescribed values', () => {
    const noise = 4.440892098500626e-16;
    expect(displayZero(noise, 2)).toBe(0);
    expect(displayZero(-noise, 2)).toBe(0);
    expect(displayZero(noise)).toBe(noise);
    expect(displayZero(1e-9, 1e9)).toBe(1e-9);
    expect(displayZero(-2e-6, 10)).toBe(-2e-6);
    expect(displayZero(2e-15, 1e-12)).toBe(2e-15);
    expect(displayQuantity(-0, 'W')).toBe('0 W');
    expect(displayQuantity(-0, 'V')).toBe('0 V');
    expect(displayNumber(-0)).toBe('0');
    expect(valueDisplay({ type: 'current_source', visible_value: '-0 mA' }).text).toBe('0 mA');
    expect(valueDisplay({ type: 'current_source', visible_value: '-2 nA' }).text).toBe('-2 nA');
    const graph = buildGraph({ ...balanced, components: balanced.components.map((part) =>
      part.id === 'I1' ? { ...part, visible_value: '2 nA' } : part) });
    const solved = solveDcCircuit(graph);
    const markup = renderToStaticMarkup(<DcSolveOutput graph={graph} result={solved} questionText="Current through I1" />);
    expect(markup).toContain('Current through I1: 2 nA');
  });

  it('formats the actual balanced-network roundoff in answers, substitutions, and superposition totals without changing any results', () => {
    const graph = buildGraph(balanced);
    const result = solveDcCircuit(graph);
    const raw = result.branches.find(({ componentId }) => componentId === 'R1').current;
    expect(raw).toBe(4.440892098500626e-16);
    const copy = structuredClone(result);
    const html = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText="Current through R1" />);
    expect(html).toContain('Current through R1: 0 A');
    const lesson = buildDcLesson(graph, result, parseDcQuestion('Current through R1'));
    const final = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} displaySolution={result} />);
    expect(final).not.toContain('4.440892');
    expect(final).toContain('0\\,\\mathrm{A}');
    expect(result).toEqual(copy);
    const flows = mapDcCurrentParticles(graph, layoutCircuit(balanced, graph), lesson.steps.at(-1));
    expect(flows.length).toBeGreaterThan(0);
    expect(flows.every(({ amperes }) => amperes > 1)).toBe(true);

    const superposition = solveDcSuperposition(graph);
    const combined = { ok: true, ...superposition.combined, referenceNodeId: superposition.referenceNodeId };
    const steps = buildDcSuperpositionLesson(superposition, parseDcQuestion('Current through R1 using superposition'));
    const totals = steps.steps.at(-1);
    const projected = displayEquation(totals.equations[0], dcDisplayContext(combined), undefined, dcDisplayContext(superposition.directResult));
    expect(projected).toMatchObject({ value: 0, directValue: 0 });
    expect(projected.terms[0].value).toBeCloseTo(-projected.terms[1].value, 12);
    const table = renderToStaticMarkup(<DcLessonStepView lesson={steps} index={steps.steps.length - 1} displaySolution={combined} superposition={superposition} />);
    expect(table).toContain('Direct MNA');
    expect(table).not.toContain('4.440892');
  });
});
