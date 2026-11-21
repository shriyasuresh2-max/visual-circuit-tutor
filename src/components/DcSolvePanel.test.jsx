import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyComponentEdits, applyComponentValues } from '../circuit/componentValue.js';
import currentSourceAnalysis from '../../tests/fixtures/dc_current_source_analysis.json';
import mixedAnalysis from '../../tests/fixtures/mixed_return_trace_analysis.json';
import partialReductionAnalysis from '../../tests/fixtures/dc_mesh_tutor_analysis.json';
import sourceTransformationAnalysis from '../../tests/fixtures/dc_supernode_analysis.json';
import { buildGraph } from '../circuit/electricalGraph.js';
import { layoutCircuit } from '../circuit/circuitLayout.js';
import { solveDcCircuit } from '../circuit/dcSolver.js';
import DcSolvePanel, { DcSolveOutput, resolveDcMethod } from './DcSolvePanel.jsx';
import { solveDcMeshCircuit } from '../circuit/dcMeshSolver.js';
import { solveDcSeriesParallel } from '../circuit/dcSeriesParallelSolver.js';
import { buildDcSeriesParallelLesson } from '../circuit/dcSeriesParallelLesson.js';
import { transformDcSources } from '../circuit/dcSourceTransformation.js';
import { buildDcSourceTransformationLesson } from '../circuit/dcSourceTransformationLesson.js';
import { DcLessonStepView } from './DcLessonSteps.jsx';
import { buildDcLesson } from '../circuit/dcLesson.js';
import { buildDcMeshLesson } from '../circuit/dcMeshLesson.js';
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
  it('selects Source Transformation and shows a separate equivalence figure and real calculations', () => {
    const graph = buildGraph(sourceTransformationAnalysis);
    const questionText = 'Find the equivalent current source';
    const intent = parseDcQuestion(questionText);
    expect(renderToStaticMarkup(<DcSolvePanel graph={graph} questionText={questionText} />))
      .toContain('<option value="transformation" selected="">Source Transformation</option>');
    expect(resolveDcMethod(intent, 'nodal').conflict).toContain('requests Source Transformation');
    const result = transformDcSources(graph, intent);
    const render = (props = {}) => renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} {...props} />);
    const markup = render();
    expect(markup).toContain('<strong>5 A</strong>');
    expect(markup).toContain('Original source and resistor');
    expect(markup).toContain('Transformed equivalent pair');
    expect(markup).toContain('<strong>Before</strong>');
    expect(markup).toContain('<strong>After</strong>');
    expect(markup).toContain('<h6>Substitute values</h6>');
    expect(markup).not.toContain('Part A');
    expect(markup).toContain('class="katex"');
    expect(render({ hasDraft: true })).not.toContain('Transformed equivalent pair');
    expect(render({ questionText: 'Current through R2' })).toContain('Current through R2: 2.6667 A');
    const unsupported = render({ result: transformDcSources(graph, { target: 'V1' }) });
    expect(unsupported).toContain('No valid source transformation');
    expect(unsupported).toContain('Try Nodal Analysis');
  });

  it('uses the verified source orientations and hides an undrawable pair without losing its equations', () => {
    const graph = buildGraph(sourceTransformationAnalysis);
    const question = parseDcQuestion('Transform current source I1');
    const result = transformDcSources(graph, question);
    const lesson = buildDcSourceTransformationLesson(graph, result, question);
    const render = (viewLesson) => renderToStaticMarkup(<DcLessonStepView lesson={viewLesson} index={0} displaySolution={result.originalResult} />);
    const markup = render(lesson);
    expect(markup).toContain('data-pair-source="current" data-reference-direction="B to A"');
    expect(markup).toContain('data-pair-source="voltage" data-reference-direction="+ toward A"');
    const invalid = structuredClone(lesson);
    invalid.steps[0].sourceIllustration.equivalent.resistor.to.node = 'unrelated-node';
    const fallback = render(invalid);
    expect(fallback).not.toContain('Source transformation comparison');
    expect(fallback).toContain('katex-mathml');
    expect(fallback).toContain('I1 and R3 share both terminal nodes');
  });

  it.each(['Find equivalent resistance', 'Solve using series-parallel', 'Simplify the resistor network'])(
    'preselects reduction for %s and explains incompatible selections', (questionText) => {
      const graph = buildGraph(mixedAnalysis);
      const markup = renderToStaticMarkup(<DcSolvePanel graph={graph} questionText={questionText} />);
      expect(markup).toContain('<option value="reduction" selected="">Series-Parallel Reduction</option>');
      expect(resolveDcMethod(parseDcQuestion(questionText), 'mesh').conflict)
        .toContain('Your question requests Series-Parallel Reduction');
      expect(resolveDcMethod(parseDcQuestion('Voltage at N1'), 'reduction').conflict).toContain('node-voltage question');
    },
  );

  it('shows the verified total and a separate equivalent figure, and preserves component answers', () => {
    const graph = buildGraph(mixedAnalysis);
    const result = solveDcSeriesParallel(graph);
    const render = (questionText) => renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} />);
    const markup = render('Find equivalent resistance');
    expect(markup).toContain('Total equivalent resistance: 7 Ω');
    expect(markup).toContain('Intermediate equivalent resistor between');
    expect(markup).toContain('Substitute values');
    expect(markup).not.toContain('Part A');
    expect(markup).toContain('class="katex"');
    expect(render('Voltage across R2')).toContain('Voltage across R2: 10.286 V');
    expect(renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} hasDraft />)).not.toContain('class="dc-lesson"');
  });

  it('never reports a total for partial or unsupported reductions', () => {
    const graph = buildGraph(partialReductionAnalysis);
    const result = solveDcSeriesParallel(graph);
    const questionText = 'Find equivalent resistance';
    const partial = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} />);
    expect(partial).toContain('Combine resistors in series');
    expect(partial).toContain('Only part of the network can be reduced');
    expect(partial).not.toContain('Total equivalent resistance:');
    const lesson = buildDcSeriesParallelLesson(result);
    const last = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} displaySolution={result} />);
    expect(last).toContain('Matching node labels are electrically connected.');
    expect(last.match(/class="dc-reduction-network-branch"/g)).toHaveLength(result.remainingGraph.branches.length);
    expect(last).not.toContain('Final answer');
    const unsupported = renderToStaticMarkup(<DcSolveOutput graph={graph}
      result={{ status: 'unsupported', ok: false, issues: [{ message: 'No valid combinations.' }] }}
      questionText={questionText} />);
    expect(unsupported).toContain('Try Nodal Analysis');
    expect(unsupported).not.toContain('class="dc-lesson"');
  });

  it('shows a focused requested result and keeps the other resistor results expandable', () => {
    const graph = buildGraph(mixedAnalysis);
    const result = solveDcSeriesParallel(graph);
    const lesson = buildDcSeriesParallelLesson(result, parseDcQuestion('Power dissipated by R2'));
    const markup = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} displaySolution={result} />);
    expect(markup).toContain('Requested result');
    expect(markup).toContain('<summary>All original resistor values</summary>');
    expect(markup).toContain('katex-mathml');
    expect(markup).not.toContain('Part B');
  });

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
      const index = lesson.steps.length - 1;
      const equation = lesson.steps[index].extraEquations.find(({ kind }) => kind === 'nodal-source-current');
      expect(equation.terms.find(({ branchId }) => branchId === 'I1')).toMatchObject({ sign: 1, sourceCurrent: amps });
      const markup = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={index} />);
      expect(markup).toContain(`(${amps}\\,\\mathrm{A})`);
      const final = lesson.steps.at(-1);
      expect(final.finalAnswer[0]).toMatchObject({ sourceCurrent: amps, value: amps });
      const svg = renderToStaticMarkup(<CircuitDiagram analysisResult={capture} electricalGraph={graph} lessonStep={final} />);
      expect(svg).toContain('data-comp-id="I1" data-lesson-highlight="component"');
      if (amps === 0) expect(svg).not.toContain('data-current-branch-id="I1"');
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
    const equations = render(steps.find(({ id }) => id === 'reference'));
    expect(equations).toContain('data-current-arrow="reference"');
    expect(equations).not.toContain('data-current-flow-net=');
    expect(equations).toContain('pointer-events="none" aria-label="Branch current arrows"');
    const final = render(steps.at(-1));
    expect(final).toContain('data-current-arrow="actual" data-current-branch-id="Load"');
    expect(final).toContain('data-current-flow-net=');
    expect(final).toContain('class="dc-current-particles" aria-hidden="true" pointer-events="none"');
    expect(final).toContain('aria-label="Pause current animation"');
    expect(final).toContain('<option value="normal" selected="">Normal</option>');
    expect(final).not.toContain('data-current-branch-id="Return"');
    expect(render(null)).not.toContain('data-current-arrow=');
    expect(render(null)).not.toContain('data-current-flow-net=');
  });

  it('places step navigation ahead of the requested answer and exposes the circuit shortcut in the workspace', () => {
    const graph = buildGraph(analysis);
    const markup = renderToStaticMarkup(<DcSolveOutput graph={graph} result={solveDcCircuit(graph)}
      questionText="Current through Load" onShowCircuit={() => {}} />);
    expect(markup).toContain('href="#workspace-circuit"');
    expect(markup).toContain('id="workspace-lesson"');
    expect(markup.indexOf('Previous Step')).toBeLessThan(markup.indexOf('Question answer'));
    expect(markup).toContain('Current through Load: 2 mA');
  });

  it('keeps long answer lists expandable and derives progress from the lesson being shown', () => {
    const graph = buildGraph(partialReductionAnalysis);
    const result = solveDcCircuit(graph);
    const intent = parseDcQuestion('All branch currents');
    const lesson = buildDcLesson(graph, result, intent);
    const markup = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText="All branch currents" />);
    expect(markup).toContain(`<summary>Show all ${result.branches.length} branch currents</summary>`);
    expect(markup).toContain(`Step 1 of ${lesson.steps.length}`);
    for (const branch of result.branches) expect(markup).toContain(`${branch.componentId} (`);
    const mesh = solveDcMeshCircuit(graph);
    expect(mesh.ok).toBe(true);
    const meshMarkup = renderToStaticMarkup(<DcSolveOutput graph={graph} result={mesh} />);
    const meshSteps = meshMarkup.match(/Step 1 of (\d+)/);
    expect(meshSteps).not.toBeNull();
    expect(Number(meshSteps[1])).toBe(buildDcMeshLesson(mesh).steps.length);
  });

  it('disables only continuous motion under the reduced-motion media query', () => {
    const appStyles = readFileSync(new URL('../App.css', import.meta.url), 'utf8');
    expect(appStyles).toMatch(/\.dc-current-flow\s*\{[^}]*animation:\s*dc-current-flow\s+var\(--dc-flow-duration\)\s+linear infinite/s);
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

  it('keeps wires and component leads identical across plain, reference, and solved views', () => {
    const graph = buildGraph(analysis);
    const { steps } = buildDcLesson(graph, solveDcCircuit(graph), parseDcQuestion('Current through Load'));
    const render = (lessonStep) => renderToStaticMarkup(
      <CircuitDiagram analysisResult={analysis} electricalGraph={graph} lessonStep={lessonStep} />,
    );
    const conductorStyles = (markup) => ({
      wires: [...markup.matchAll(/data-wire-id="[^"]+"[^>]*><polyline[^>]*><\/polyline>(<polyline[^>]*>)/g)].map((match) => match[1]),
      leads: [...markup.matchAll(/<g stroke="[^"]+" stroke-width="[^"]+"[^>]+data-component-leads="">/g)].map((match) => match[0]),
    });
    const plain = conductorStyles(render(null));
    expect(plain.wires.length).toBeGreaterThan(0);
    expect(plain.leads).toHaveLength(graph.components.length);
    const kcl = render(steps.find(({ id }) => id === 'kcl'));
    const solved = render(steps.at(-1));
    expect(conductorStyles(kcl)).toEqual(plain);
    expect(conductorStyles(solved)).toEqual(plain);
    expect(kcl).toMatch(/data-lesson-highlight="kcl" fill="#fcd34d"/);
    expect(solved).toMatch(/<text[^>]*fill="#e9bb70"[^>]*>Load/);
    expect(solved).toContain('--dc-flow-spacing:10px');
    expect(solved).toContain('class="dc-current-flow"');
  });

  it('shows step navigation for a supported question and bounds both ends', () => {
    const graph = buildGraph(analysis);
    const result = solveDcCircuit(graph);
    const questionText = 'Current through Load';
    const lesson = buildDcLesson(graph, result, parseDcQuestion(questionText));
    const first = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} />);
    expect(first).toContain(`Step 1 of ${lesson.steps.length}`);
    expect(first).toContain('Label the nodes and choose 0 V');
    expect(first).not.toContain('Part A');
    expect(first).not.toContain('Part B');
    expect(first).toMatch(/disabled="">Previous Step/);
    expect(first).not.toMatch(/disabled="">Next Step/);
    const last = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} />);
    expect(last).toContain(`Step ${lesson.steps.length} of ${lesson.steps.length}`);
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
    expect(html).toContain('<h6>Formula</h6>');
    expect(html).toContain('\\frac{\\Delta V_{\\text{Load}}}{R_{\\text{Load}}}');
    expect(html).toContain('<h6>Substitute values</h6>');
    expect(html).toContain('\\frac{4\\,\\mathrm{V}}{2000\\,\\Omega}');
    expect(html).toContain('<strong>Final answer</strong>');
    expect(html).toContain('All solved voltages and currents');
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
    expect(equations.match(/<annotation /g)).toHaveLength(lesson.steps[kcl].equations.length * 2);
    for (const equation of lesson.steps[kcl].workedEquations) {
      expect(equations).toContain(lessonEquationTex(equation, 'formula'));
      expect(equations).toContain(lessonEquationTex(equation, 'substitution'));
    }
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
    expect(html).toContain(`Step 1 of ${buildDcLesson(graph, result, parseDcQuestion('')).steps.length}`);
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
    expect(unsupported).toContain('Your question requests Mesh Analysis');
    expect(unsupported).not.toContain('Step-by-Step Solution');
    expect(unsupported).not.toContain('<strong>Current through Load:');
    const invalid = applyComponentValues(analysis, new Map([['Load', null]]));
    const failed = renderToStaticMarkup(
      <DcSolveOutput result={solveDcCircuit(buildGraph(invalid))} questionText={questionText} />,
    );
    expect(failed).toContain('Component Load has no reported value');
    expect(failed).not.toContain('<table>');
  });

  it('defaults to nodal and preselects mesh for an explicit mesh question', () => {
    const graph = buildGraph(analysis);
    expect(renderToStaticMarkup(<DcSolvePanel graph={graph} />))
      .toContain('<option value="nodal" selected="">Nodal Analysis</option>');
    const questionText = 'Find mesh currents';
    expect(renderToStaticMarkup(<DcSolvePanel graph={graph} questionText={questionText} />))
      .toContain('<option value="mesh" selected="">Mesh Analysis</option>');
    expect(resolveDcMethod(parseDcQuestion(questionText), 'nodal').conflict).toContain('requests Mesh Analysis');
    const result = solveDcMeshCircuit(graph);
    const panel = renderToStaticMarkup(<DcSolveOutput graph={graph} result={result} questionText={questionText} />);
    expect(panel).toContain('Choose a direction for M1');
    expect(panel).toContain('class="katex"');
    const failed = renderToStaticMarkup(<DcSolveOutput graph={graph}
      result={{ ok: false, issues: [{ code: 'unsupported-method', message: 'The graph is nonplanar.' }] }}
      questionText={questionText} />);
    expect(failed).toContain('The graph is nonplanar.');
  });

  it('uses compact KaTeX steps and keeps other results accessible for a named mesh answer', () => {
    const result = solveDcMeshCircuit(buildGraph(analysis));
    const lesson = buildDcMeshLesson(result, parseDcQuestion('Find current through Load using mesh analysis'));
    const first = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={0} displaySolution={result} />);
    expect(first).toContain('Loop reference path');
    expect(first).toContain('Substitute values');
    expect(first).not.toContain('Part A');
    const final = renderToStaticMarkup(<DcLessonStepView lesson={lesson} index={lesson.steps.length - 1} displaySolution={result} />);
    expect(final).toContain('Find the current through Load');
    expect(final).toContain('Final answer');
    expect(final).toContain('Other solved voltages and currents');
    expect(final).toContain('katex-mathml');
    expect(final).toContain('disabled="">Next Step');
  });

  it('renders curved reference arrows with equation labels only during mesh setup', () => {
    const graph = buildGraph(mixedAnalysis);
    const { steps } = buildDcMeshLesson(solveDcMeshCircuit(graph));
    const render = (lessonStep) => renderToStaticMarkup(
      <CircuitDiagram analysisResult={mixedAnalysis} electricalGraph={graph} lessonStep={lessonStep} />,
    );
    const markup = render(steps[2]);
    expect(markup).toContain('data-mesh-current-arrow="M1" data-mesh-emphasis="active"');
    expect(markup).toContain('data-mesh-current-arrow="M2" data-mesh-emphasis="related"');
    expect(markup).toMatch(/Reference mesh current M1, counterclockwise[^>]*><path d="M [^"]* A /);
    expect(markup).toContain('baseline-shift="sub" font-size="74%">M1');
    expect(markup).not.toContain('data-current-flow-net=');
    const solved = render(steps.at(-1));
    expect(solved).not.toContain('data-mesh-current-arrow=');
    expect(solved).toContain('data-current-flow-net=');
    expect(render(null)).not.toContain('data-mesh-current-arrow=');
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
