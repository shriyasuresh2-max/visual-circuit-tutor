import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyComponentEdits, applyComponentValues } from '../circuit/componentValue.js';
import currentSourceAnalysis from '../../tests/fixtures/dc_current_source_analysis.json';
import { buildGraph } from '../circuit/electricalGraph.js';
import { layoutCircuit } from '../circuit/circuitLayout.js';
import { solveDcCircuit } from '../circuit/dcSolver.js';
import DcSolvePanel, { DcSolveOutput } from './DcSolvePanel.jsx';
import { DcLessonStepView } from './DcLessonSteps.jsx';
import { buildDcLesson } from '../circuit/dcLesson.js';
import { lessonEquationTex } from '../circuit/dcLessonMath.js';
import { parseDcQuestion } from '../circuit/dcQuestions.js';
import CircuitDiagram from './CircuitDiagram.jsx';

const analysis = {
  components: [
    { id: 'Source', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '−' }] },
    { id: 'Load', type: 'resistor', visible_value: '2 kΩ', terminals: [{ label: 'A' }, { label: 'B' }] },
    { id: 'Return', type: 'resistor', visible_value: '4 kΩ', terminals: [{ label: 'A' }, { label: 'B' }] },
  ],
  nodes: [
    { id: 'supply', members: ['Source.+', 'Load.A'] },
    { id: 'tap', members: ['Load.B', 'Return.A'] },
    { id: 'reference', members: ['Source.−', 'Return.B'] },
  ],
};

function renderSolution(graph, questionText = '') {
  return renderToStaticMarkup(<DcSolveOutput graph={graph} result={solveDcCircuit(graph)} questionText={questionText} />);
}

describe('reconstructed circuit solver panel', () => {
  it('renders one noninteractive node label per node and reuses physical junction markers', () => {
    const graph = buildGraph(currentSourceAnalysis);
    const markup = renderToStaticMarkup(
      <CircuitDiagram analysisResult={currentSourceAnalysis} electricalGraph={graph} />,
    );
    expect(markup.match(/data-node-label=/g)).toHaveLength(graph.nodes.length);
    expect(markup.match(/pointer-events="none" data-node-label="N\d+" data-node-anchor-kind="junction"><text/g))
      .toHaveLength(graph.nodes.length);
  });

  it('renders a verified reference arrow along vertical and horizontal source terminals', () => {
    const horizontal = {
      ...currentSourceAnalysis,
      components: currentSourceAnalysis.components.map((component) => ({
        ...component,
        terminals: component.terminals.map(({ label, position }) => ({
          label, position: { x: position.y, y: position.x },
        })),
      })),
    };
    for (const [capture, angle] of [[currentSourceAnalysis, 90], [horizontal, 0]]) {
      const graph = buildGraph(capture);
      const layout = layoutCircuit(capture, graph);
      expect(layout.components.find(({ id }) => id === 'I1').angle).toBeCloseTo(angle);
      const svg = renderToStaticMarkup(<CircuitDiagram analysisResult={capture} electricalGraph={graph} />);
      expect(svg).toContain('aria-label="Reference arrow B to A" data-source-arrow="reverse" transform="rotate(180)"');
      expect(svg).toContain('2 mA');
    }
  });

  it('requires confirmation for missing or invalid directions and applies edits without changing nets', () => {
    const ambiguous = applyComponentEdits(currentSourceAnalysis, new Map([['I1', {
      currentDirection: { fromTerminal: 'Z', toTerminal: 'A' },
    }]]));
    const incomplete = buildGraph(ambiguous);
    expect(incomplete.components[0].currentDirection).toBeNull();
    const failed = solveDcCircuit(incomplete);
    expect(failed.issues[0].code).toBe('unknown-current-direction');
    expect(renderToStaticMarkup(<CircuitDiagram analysisResult={ambiguous} electricalGraph={incomplete} />))
      .not.toContain('data-source-arrow=');
    expect(renderToStaticMarkup(<DcSolvePanel graph={incomplete} />)).toContain('Confirm arrow direction');
    const edited = applyComponentEdits(ambiguous, new Map([['I1', {
      visible_value: '−1 mA', currentDirection: { fromTerminal: 'A', toTerminal: 'B' },
    }]]));
    const graph = buildGraph(edited);
    expect(graph.nodes).toEqual(incomplete.nodes);
    expect(solveDcCircuit(graph).branches[0]).toMatchObject({
      fromTerminal: 'A', toTerminal: 'B', sourceCurrent: -0.001, current: -0.001, voltage: 3,
    });
  });

  it('substitutes signed known current, highlights its branch, and skips zero current animation', () => {
    for (const [value, amps] of [['−2 mA', -0.002], ['0 A', 0]]) {
      const capture = applyComponentValues(currentSourceAnalysis, new Map([['I1', value]]));
      const graph = buildGraph(capture);
      const result = solveDcCircuit(graph);
      const lesson = buildDcLesson(graph, result, parseDcQuestion('Current supplied by current source I1'));
      const index = lesson.steps.findIndex(({ id }) => id === 'substitute');
      const equation = lesson.steps[index].equations.find(({ kind }) => kind === 'kcl');
      expect(equation.terms.find(({ branchId }) => branchId === 'I1')).toMatchObject({ sign: -1, sourceCurrent: amps });
      const markup = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={index} />);
      expect(markup).toContain(`- \\bigl(${amps}\\,\\mathrm{A}\\bigr)`);
      const final = lesson.steps.at(-1);
      expect(final.finalAnswer[0]).toMatchObject({ sourceCurrent: amps, value: amps });
      const svg = renderToStaticMarkup(<CircuitDiagram analysisResult={capture} electricalGraph={graph} lessonStep={final} />);
      expect(svg).toContain('data-comp-id="I1" data-lesson-highlight="component"');
      if (amps === 0) expect(svg).not.toContain('data-current-flow-branch-id="I1"');
      else expect(svg).toContain('I1 actual current from A to B');
    }
  });

  it('renders a non-interactive arrow overlay for the current lesson mode only', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const { steps } = buildDcLesson(graph, result, parseDcQuestion('Current through Load'));
    const render = (lessonStep) => renderToStaticMarkup(
      <CircuitDiagram analysisResult={analysis} electricalGraph={graph} lessonStep={lessonStep} />,
    );
    const equations = render(steps.find(({ id }) => id === 'directions'));
    expect(equations).toContain('data-current-arrow="reference"');
    expect(equations).not.toContain('data-current-flow-branch-id=');
    expect(equations).toContain('pointer-events="none" aria-label="Branch current arrows"');
    const final = render(steps.at(-1));
    expect(final).toContain('data-current-arrow="actual" data-current-branch-id="Load"');
    expect(final).toContain('data-current-flow-branch-id="Load"');
    expect(final).toContain('aria-hidden="true" pointer-events="none"><polyline class="dc-current-flow"');
    expect(final).not.toContain('data-current-branch-id="Return"');
    expect(render(null)).not.toContain('data-current-arrow=');
    expect(render(null)).not.toContain('data-current-flow-branch-id=');
  });

  it('disables only continuous motion under the reduced-motion media query', () => {
    const appStyles = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    expect(appStyles).toMatch(/\.dc-current-flow\s*\{[^}]*animation:\s*dc-current-flow\s+[\w.]+\s+linear infinite/s);
    expect(appStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.dc-current-flow\s*\{[^}]*animation:\s*none;[^}]*display:\s*none;/s);
  });

  it('marks only mapped SVG elements and drops all emphasis when focus clears', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const { steps } = buildDcLesson(graph, result, parseDcQuestion('Current through Load'));
    const render = (lessonStep) => renderToStaticMarkup(
      <CircuitDiagram analysisResult={analysis} electricalGraph={graph} lessonStep={lessonStep} />,
    );
    const reference = render(steps.find(({ id }) => id === 'reference'));
    expect(reference).toContain(`data-lesson-node-id="${result.referenceNodeId}" data-lesson-highlight="reference"`);
    const focused = render(steps.at(-1));
    expect(focused).toContain('data-comp-id="Load" data-lesson-highlight="component"');
    expect(focused).not.toContain('data-comp-id="Return" data-lesson-highlight');
    expect(focused).toMatch(/data-wire-id="[^"]+" data-lesson-highlight="wire"/);
    expect(focused).toContain('4 kΩ');
    expect(render(null)).not.toContain('data-lesson-highlight=');
  });

  it('shows step navigation for a supported question and bounds both ends', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const questionText = 'Current through Load';
    const lesson = buildDcLesson(graph, result, parseDcQuestion(questionText));
    const first = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} />);
    expect(first).toContain('Step 1 of 8');
    expect(first).toContain('Part A — What are we finding?');
    expect(first).not.toContain('Part B');
    expect(first).toMatch(/disabled="">Previous Step/);
    expect(first).not.toMatch(/disabled="">Next Step/);
    const last = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} />);
    expect(last).toContain('Step 8 of 8');
    expect(last).toContain('Final answer');
    expect(last).toMatch(/disabled="">Next Step/);
    expect(last).not.toMatch(/disabled="">Previous Step/);
    expect(renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} hasDraft />))
      .not.toContain('Step-by-Step Solution');
  });

  it('presents verified final calculations in formula, substitution, and result stages', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const lesson = buildDcLesson(graph, result, parseDcQuestion('Current through Load'));
    const html = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} />);
    expect(html).toContain('Calculate current through Load');
    expect(html).toContain('Stage 1 — Formula');
    expect(html).toContain('\\frac{\\Delta V_{\\text{Load}}}{R_{\\text{Load}}}');
    expect(html).toContain('Stage 2 — Substitute values');
    expect(html).toContain('\\frac{4\\,\\mathrm{V}}{2000\\,\\Omega}');
    expect(html).toContain('Stage 3 — Final answer');
    expect(html).toContain('\\approx 0.002\\,\\mathrm{A}');
    expect(html).toContain('<mfrac>');
    expect(html).toContain('<msub>');
  });

  it('keeps every KCL equation and shows a direct node result without empty stages', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const lesson = buildDcLesson(graph, result, parseDcQuestion(`Voltage at ${result.referenceNodeId}`));
    const kcl = lesson.steps.findIndex(({ id }) => id === 'kcl');
    const equations = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={kcl} />);
    expect(equations.match(/<annotation /g)).toHaveLength(lesson.steps[kcl].equations.length);
    for (const equation of lesson.steps[kcl].equations) expect(equations).toContain(lessonEquationTex(equation));
    // Inline KaTeX can wrap between terms while preserving the display-style fractions.
    expect(equations).toContain('\\displaystyle');
    expect(equations).not.toContain('class="katex-display"');
    const answer = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} />);
    expect(answer).toContain('\\approx 0\\,\\mathrm{V}');
    expect(answer).not.toContain('Stage 1');
    expect(answer).not.toContain('Part B');
  });

  it('escapes unsupported expressions instead of sending them to the math renderer', () => {
    const lesson = { steps: [{
      title: 'Unsupported expression', explanation: 'Read the original expression.',
      equations: [{ kind: 'unknown-format', expression: '<script>alert(1)</script>' }],
    }] };
    const html = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={0} />);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('class="katex"');
  });

  it('promotes a question-specific answer without standalone results', () => {
    const result = solveDcCircuit(buildGraph(analysis));
    const html = renderToStaticMarkup(<DcSolveOutput result={result} questionText="Power dissipated by Load" />);
    expect(html).toContain('<strong>Power dissipated by Load: 0.008 W</strong>');
    expect(html).toContain('P = ΔV × I');
    expect(html).not.toContain('Full DC analysis');
    expect(html).not.toContain('<table>');
  });

  it('shows the default nodal lesson without standalone results when the question is blank', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const html = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText="  " />);
    expect(html).toContain('Step-by-Step Solution');
    expect(html).toContain('Step 1 of 8');
    expect(html).toContain('Previous Step');
    expect(html).toContain('Next Step');
    expect(html).not.toContain('Question answer');
    expect(html).not.toContain('<table>');
    expect(html).not.toContain('Full DC analysis');
    expect(html).not.toContain('Voltage is first terminal minus second');
  });

  it('withdraws a stale answer while values are edited and uses the updated solution', () => {
    const questionText = 'Current through Load';
    const initial = solveDcCircuit(buildGraph(analysis));
    const render = (result, hasDraft) => renderToStaticMarkup(
      <DcSolveOutput result={result} questionText={questionText} hasDraft={hasDraft} />,
    );
    expect(render(initial)).toContain('Current through Load: 2 mA');
    expect(render(initial, true)).not.toContain('2 mA');
    expect(render(initial, true)).toContain('Values changed');
    expect(render(null)).toBe('');
    const corrected = applyComponentValues(analysis, new Map([['Load', '8 kΩ']]));
    const next = render(solveDcCircuit(buildGraph(corrected)));
    expect(next).toContain('Current through Load: 1 mA');
    expect(next).not.toContain('Current through Load: 2 mA');
  });

  it('shows a method limitation and gives only the solver error if the graph is unsolved', () => {
    const questionText = 'Find current through Load using mesh analysis';
    const result = solveDcCircuit(buildGraph(analysis));
    const unsupported = renderToStaticMarkup(<DcSolveOutput result={result} questionText={questionText} />);
    expect(unsupported).toContain('The requested method is unavailable');
    expect(unsupported).not.toContain('Step-by-Step Solution');
    expect(unsupported).not.toContain('<strong>Current through Load:');
    const invalid = applyComponentValues(analysis, new Map([['Load', null]]));
    const failed = renderToStaticMarkup(
      <DcSolveOutput result={solveDcCircuit(buildGraph(invalid))} questionText={questionText} />,
    );
    expect(failed).toContain('Component Load has no reported value');
    expect(failed).not.toContain('<table>');
  });

  it('offers an explicit solve action and starts without calculated results', () => {
    const html = renderToStaticMarkup(<DcSolvePanel graph={buildGraph(analysis)} onApplyValues={() => {}} />);
    expect(html).toContain('Solve Circuit');
    expect(html).toContain('Edit component values');
    expect(html).not.toContain('<table>');
  });

  it('answers explicit requests for all node voltages or branch currents without tables', () => {
    const graph = buildGraph(analysis);
    const nodes = renderSolution(graph, 'All node voltages');
    expect(nodes).toContain('<li>N1: 0 V</li>');
    expect(nodes).not.toContain('<table>');
    const currents = renderSolution(graph, 'All branch currents');
    expect(currents).toContain('<li>Load (A → B): 2 mA</li>');
    expect(currents).toContain('<li>Source (+ → −): -2 mA</li>');
    expect(currents).not.toContain('<table>');
  });

  it('passes corrected values to both the schematic and the solver', () => {
    const corrected = applyComponentValues(analysis, new Map([['Load', '8 kΩ']]));
    const graph = buildGraph(corrected);
    const layout = layoutCircuit(corrected, graph);
    expect(analysis.components[1].visible_value).toBe('2 kΩ');
    expect(layout.nodes.map(({ members }) => members)).toEqual(graph.nodes.map(({ members }) => members));
    expect(layout.components.find(({ id }) => id === 'Load').value).toBe('8 kΩ');
    const html = renderSolution(graph, 'Current through Load');
    expect(html).toContain('Current through Load: 1 mA');
    expect(html).toContain('8000 Ω');
    expect(html).not.toContain('2000 Ω');
  });

  it('uses updated node membership, and withdraws numbers if connectivity becomes disputed', () => {
    const changed = {
      ...analysis,
      nodes: [
        { id: 'supply', members: ['Source.+', 'Load.A', 'Return.A'] },
        { id: 'reference', members: ['Source.−', 'Load.B', 'Return.B'] },
      ],
    };
    expect(renderSolution(buildGraph(changed), 'Current through Load')).toContain('Current through Load: 6 mA');
    const disputed = buildGraph({
      ...changed,
      connections: [{ from_component: 'Load', from_terminal: 'A', to_component: 'Load', to_terminal: 'B' }],
    });
    const html = renderSolution(disputed);
    expect(html).toContain('Resolve disputed or incomplete connectivity');
    expect(html).not.toContain('Step-by-Step Solution');
  });

  it('replaces numerical output with useful errors for missing values and unsupported components', () => {
    const missing = renderSolution(buildGraph(applyComponentValues(analysis, new Map([['Load', null]]))));
    expect(missing).toContain('Component Load has no reported value.');
    expect(missing).not.toContain('<table>');

    const unsupported = renderSolution(buildGraph({
      ...analysis,
      components: analysis.components.map((component) => component.id === 'Load'
        ? { ...component, type: 'capacitor', visible_value: '2 µF' }
        : component),
    }));
    expect(unsupported).toContain('Component Load has unsupported type capacitor.');
    expect(unsupported).not.toContain('<table>');
  });

  it('names floating nodes without showing numerical output', () => {
    const floating = buildGraph({
      components: [
        ...analysis.components,
        { ...analysis.components[1], id: 'FloatA' },
        { ...analysis.components[1], id: 'FloatB' },
      ],
      nodes: [
        ...analysis.nodes,
        { id: 'float-a', members: ['FloatA.A', 'FloatB.A'] },
        { id: 'float-b', members: ['FloatA.B', 'FloatB.B'] },
      ],
    });
    const html = renderSolution(floating);
    expect(html).toContain('floating voltages');
    expect(html).toContain('Nodes: N3, N4');
    expect(html).not.toContain('<table>');
  });
});
