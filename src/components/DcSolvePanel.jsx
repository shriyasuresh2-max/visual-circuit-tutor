import React, { useMemo, useState } from 'react';
import { solveDcCircuit } from '../circuit/dcSolver.js';
import { solveDcMeshCircuit } from '../circuit/dcMeshSolver.js';
import { buildDcMeshLesson } from '../circuit/dcMeshLesson.js';
import { solveDcSeriesParallel } from '../circuit/dcSeriesParallelSolver.js';
import { buildDcSeriesParallelLesson } from '../circuit/dcSeriesParallelLesson.js';
import { transformDcSources } from '../circuit/dcSourceTransformation.js';
import { buildDcSourceTransformationLesson } from '../circuit/dcSourceTransformationLesson.js';
import { solveDcSuperposition } from '../circuit/dcSuperposition.js';
import { buildDcSuperpositionLesson } from '../circuit/dcSuperpositionLesson.js';
import { valueDisplay } from '../circuit/componentValue.js';
import { answerDcQuestion, parseDcQuestion } from '../circuit/dcQuestions.js';
import { buildDcLesson } from '../circuit/dcLesson.js';
import DcLessonSteps from './DcLessonSteps.jsx';
import { dcValueKind } from '../circuit/electricalValue.js';
import { dcDisplayContext, displayQuantity as quantity } from '../circuit/electricalDisplay.js';


function current(value) {
  const magnitude = Math.abs(value);
  if (magnitude >= 1e-9 && magnitude < 1e-6) return quantity(value * 1e9, 'nA');
  if (magnitude >= 1e-6 && magnitude < 1e-3) return quantity(value * 1e6, 'µA');
  if (magnitude >= 1e-3 && magnitude < 1) return quantity(value * 1000, 'mA');
  return quantity(value, 'A');
}

function IssueList({ issues }) {
  return <ul>{issues.map((issue, index) => (
    <li key={`${issue.code}-${index}`}>
      {issue.message}
      {issue.nodeIds?.length > 0 && <> Nodes: {issue.nodeIds.join(', ')}.</>}
      {issue.diagnostics?.length > 0 && <ul>{issue.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul>}
      {issue.issues?.length > 0 && <IssueList issues={issue.issues} />}
    </li>
  ))}</ul>;
}

function DcSolveIssues({ issues, title = 'Circuit could not be solved' }) {
  return (
    <div className="dc-solve-issues" role="alert">
      <h3>{title}</h3>
      <IssueList issues={issues} />
    </div>
  );
}

function AnswerList({ count, quantity, children }) {
  const list = <ul>{children}</ul>;
  return count > 4 ? <details className="dc-answer-list">
    <summary>Show all {count} {quantity}</summary>
    {list}
  </details> : list;
}

const METHOD_LABELS = { nodal: 'Nodal Analysis', mesh: 'Mesh Analysis', reduction: 'Series-Parallel Reduction',
  transformation: 'Source Transformation', superposition: 'Superposition Theorem' };
const SOLVERS = { nodal: solveDcCircuit, mesh: solveDcMeshCircuit, reduction: solveDcSeriesParallel,
  transformation: transformDcSources, superposition: solveDcSuperposition };

export function resolveDcMethod(intent, selection) {
  const method = selection ?? intent.method ?? 'nodal';
  let conflict = null;
  if (intent.method && method !== intent.method) {
    conflict = `Your question requests ${METHOD_LABELS[intent.method]}. Select that method to solve it.`;
  } else if (method === 'reduction' && ['node-voltage', 'node-voltages'].includes(intent.kind)) {
    conflict = 'Series-Parallel Reduction reports branch voltages. Use Nodal Analysis or Mesh Analysis for a node-voltage question.';
  }
  return { method, conflict };
}

function QuestionAnswer({ answer, result, lesson, transformation }) {
  const { kind, branch, node, message } = answer;
  const read = dcDisplayContext(result);
  const displayCurrent = (branch, value = branch.current) => current(read(value, 'A', branch.componentId));
  const displayVoltage = (id, value, mode) => quantity(read(value, 'V', id, mode), 'V');
  const displayPower = (id, value) => quantity(read(value, 'W', id), 'W');
  const mesh = result.method === 'mesh-current-analysis';
  const reduction = result.status === 'complete';
  switch (kind) {
    case 'unsupported':
      return <p role="status">{message}</p>;
    case 'node-voltage':
      return (
        <>
          <strong>{node.id}: {displayVoltage(node.id, node.voltage, 'node')}</strong>
          <p>This potential is relative to {result.referenceNodeId} (0 V).</p>
        </>
      );
    case 'general':
      if (result.method === 'superposition') return <p>Inspect each source’s contribution, then compare the signed totals with the direct MNA solution.</p>;
      return <p>{reduction ? 'The lesson combines resistors, solves the equivalent load, and works back to the original branches.'
        : mesh ? 'Mesh analysis uses voltage balance around bounded loops to find branch currents.'
        : 'Modified nodal analysis balances current at each node and applies the voltage-source constraints.'}</p>;
    case 'superposition':
      return <p>The lesson shows the individual source responses and their signed totals.</p>;
    case 'equivalent-resistance':
      return <strong>Total equivalent resistance: {quantity(result.equivalentResistance, 'Ω')}</strong>;
    case 'mesh-currents':
      return <p>The solved mesh currents appear in the lesson. Their signs follow the chosen loop directions.</p>;
    case 'supermesh':
      return <p>The lesson shows how current constraints and the combined boundary enter the equations when applicable.</p>;
    case 'supernode':
      if (!lesson?.ok) return null;
      return <p>{lesson.noSupernodeMessage ?? lesson.supernodes.map(({ nodeIds, sources }, index) =>
        `Supernode ${index + 1} groups ${nodeIds.join(', ')} through ${sources.map(({ componentId }) => componentId).join(', ')}.`).join(' ')}</p>;
    case 'source-transformation':
      return <ul>{transformation.steps.map(({ id, a, b, original, equivalent }) => (
        <li key={id}>{original.source.id} and {original.resistor.id} yield an equivalent {equivalent.source.kind} source of{' '}
          <strong>{quantity(equivalent.source.value, equivalent.source.kind === 'current' ? 'A' : 'V')}</strong> between {a} and {b}.</li>
      ))}</ul>;
    case 'node-voltages':
      return (
        <>
          <p>Voltages are relative to {result.referenceNodeId} (0 V).</p>
          <AnswerList count={result.nodes.length} quantity="node voltages">
            {result.nodes.map(({ id, voltage }) => <li key={id}>{id}: {displayVoltage(id, voltage, 'node')}</li>)}
          </AnswerList>
        </>
      );
    case 'branch-currents':
      return (
        <>
          <AnswerList count={result.branches.length} quantity="branch currents">
            {result.branches.map((entry) => (
              <li key={entry.componentId}>{entry.componentId} ({entry.fromTerminal} → {entry.toTerminal}): {displayCurrent(entry)}</li>
            ))}
          </AnswerList>
          <p>{reduction ? 'Each branch current is recovered by expanding the equivalent groups.'
            : mesh ? 'Each branch current is the signed sum of the mesh currents through that branch.'
            : 'Current-source values are given. MNA solves voltage-source currents and uses I = ΔV ÷ R for resistors.'} Positive current follows the terminal arrow.</p>
        </>
      );
    case 'resistor-voltage': {
      if (reduction) return (
        <>
          <strong>Voltage across {branch.componentId}: {displayVoltage(branch.componentId, answer.value)}</strong>
          <p>This is the recovered signed voltage drop from terminal {branch.fromTerminal} to {branch.toTerminal}.</p>
        </>
      );
      const from = result.nodes.find((entry) => entry.id === branch.fromNodeId).voltage;
      const to = result.nodes.find((entry) => entry.id === branch.toNodeId).voltage;
      return (
        <>
          <strong>Voltage across {branch.componentId}: {displayVoltage(branch.componentId, answer.value)}</strong>
          <p>Subtract the voltage at {branch.toTerminal} from the voltage at {branch.fromTerminal}: {displayVoltage(branch.fromNodeId, from, 'node')} − ({displayVoltage(branch.toNodeId, to, 'node')}).</p>
        </>
      );
    }
    case 'resistor-power':
      return (
        <>
          <strong>Power dissipated by {branch.componentId}: {displayPower(branch.componentId, answer.value)}</strong>
          <p>P = ΔV × I = {displayVoltage(branch.componentId, branch.voltage)} × ({displayCurrent(branch)}). Both signs use {branch.fromTerminal} → {branch.toTerminal}.</p>
        </>
      );
    case 'source-supply':
      return (
        <>
          <strong>Current supplied by {branch.componentId}: {displayCurrent(branch, answer.value)}</strong>
          {branch.sourceCurrent != null
            ? <p>The source specifies this current. Positive follows its reference arrow, {branch.fromTerminal} → {branch.toTerminal}.</p>
            : <p>The solved branch current is {displayCurrent(branch)} into the positive terminal. Supplied current reverses that sign, so positive means the source delivers current from its positive terminal.</p>}
        </>
      );
    case 'branch-current':
      return (
        <>
          <strong>Current through {branch.componentId}: {displayCurrent(branch, answer.value)}</strong>
          {branch.resistance != null ? (
            <p>I = ΔV ÷ R = {displayVoltage(branch.componentId, branch.voltage)} ÷ {quantity(branch.resistance, 'Ω')}. Positive current flows {branch.fromTerminal} → {branch.toTerminal}.</p>
          ) : branch.sourceCurrent != null ? (
            <p>The source specifies this current. Positive follows its reference arrow, {branch.fromTerminal} → {branch.toTerminal}.</p>
          ) : (
            <p>{reduction ? 'The equivalent resistance gives the source current.'
              : mesh ? 'The branch current comes from the signed mesh currents.' : 'MNA solves this source current directly.'} Positive current flows {branch.fromTerminal} → {branch.toTerminal} through the source.</p>
          )}
        </>
      );
    default:
      return null;
  }
}

export function DcSolveOutput({ graph, result, questionText = '', hasDraft = false, onStepChange, onShowCircuit }) {
  const intent = useMemo(() => parseDcQuestion(questionText), [questionText]);
  const hasQuestion = Boolean(questionText.trim());
  const method = result?.method === 'superposition' ? 'superposition' : result?.method === 'source-transformation' ? 'transformation'
    : result?.status ? 'reduction' : result?.method === 'mesh-current-analysis' ? 'mesh' : 'nodal';
  const { conflict } = resolveDcMethod(intent, method);
  const lesson = useMemo(() => {
    if (!graph || !result?.ok || hasDraft || conflict) return null;
    if (method === 'mesh') return buildDcMeshLesson(result, intent);
    if (method === 'reduction') return buildDcSeriesParallelLesson(result, intent);
    if (method === 'transformation') return buildDcSourceTransformationLesson(graph, result, intent);
    if (method === 'superposition') return buildDcSuperpositionLesson(result, intent, graph);
    return buildDcLesson(graph, result, intent);
  }, [graph, result, intent, hasDraft, method, conflict]);
  if (hasDraft) return <p>Values changed. Solve Circuit to update the results.</p>;
  if (!result) return null;
  if (!result.ok) return (
    <>
      <DcSolveIssues issues={result.issues} title={method === 'transformation' && result.status === 'unsupported'
        ? 'No valid source transformation' : undefined} />
      {result.status === 'unsupported' && <p>Try Nodal Analysis or, for a supported planar circuit, Mesh Analysis.</p>}
    </>
  );
  if (conflict) return <p role="status">{conflict}</p>;
  const transformation = method === 'transformation' ? result : null;
  const answerResult = transformation?.originalResult ??
    (method === 'superposition' ? { ok: true, method, referenceNodeId: result.referenceNodeId, ...result.combined }
      : result.status === 'complete' ? { ...result, branches: [...result.branches, result.source] } : result);
  const answer = transformation && intent.kind === 'source-transformation' ? intent : answerDcQuestion(intent, answerResult);
  const summary = hasQuestion && (
    <section className="dc-question-answer" aria-label="Question answer">
      <h3>Answer</h3>
      {method === 'reduction' && result.status === 'partial' && intent.kind !== 'unsupported'
        ? <p>Only part of the network can be reduced. The lesson shows the valid combinations.</p>
        : <QuestionAnswer answer={answer} result={answerResult} lesson={lesson} transformation={transformation} />}
    </section>
  );
  return (
    <>
      {lesson?.ok ? <DcLessonSteps lesson={lesson} onStepChange={onStepChange} displaySolution={answerResult}
        superposition={method === 'superposition' ? result : undefined} summary={summary} onShowCircuit={onShowCircuit} /> : summary}
      {transformation && !answerResult.ok && <DcSolveIssues issues={answerResult.issues} />}
      {lesson && !lesson.ok && method === 'nodal' && answer.kind !== 'unsupported'
        && <p role="status">{lesson.message}</p>}
    </>
  );
}

export default function DcSolvePanel({ graph, onApplyValues, questionText = '', onStepChange, onShowCircuit }) {
  const [solveVersion, setSolveVersion] = useState(0);
  const [draft, setDraft] = useState(() => new Map());
  const [selection, setSelection] = useState(null);
  const intent = useMemo(() => parseDcQuestion(questionText), [questionText]);
  const { method, conflict } = resolveDcMethod(intent, selection);
  const hasDraft = draft.size > 0;
  const result = useMemo(() => (
    solveVersion > 0 && !hasDraft && !conflict
      ? SOLVERS[method](graph, method === 'transformation' && intent.kind === 'source-transformation' ? intent : undefined) : null
  ), [graph, solveVersion, hasDraft, method, conflict, intent]);
  const editable = graph.components.filter((component) => dcValueKind(component.type));

  function updateDraft(id, field, next, original) {
    setDraft((previous) => {
      const updated = new Map(previous);
      const edit = { ...updated.get(id) };
      if (next === original) delete edit[field];
      else edit[field] = next;
      if (Object.keys(edit).length) updated.set(id, edit);
      else updated.delete(id);
      return updated;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (hasDraft) {
      const updates = new Map();
      for (const { id, terminals } of editable) {
        const edit = draft.get(id);
        if (!edit) continue;
        const update = {};
        if ('value' in edit) update.visible_value = edit.value.trim() || null;
        if ('fromTerminal' in edit) {
          const fromTerminal = edit.fromTerminal;
          update.currentDirection = fromTerminal
            ? { fromTerminal, toTerminal: terminals.find(({ label }) => label !== fromTerminal).label }
            : null;
        }
        updates.set(id, update);
      }
      onApplyValues(updates);
      setDraft(new Map());
    }
    setSolveVersion((version) => version + 1);
  }

  return (
    <section className="diagram-panel dc-solve-panel" aria-labelledby="dc-solve-title">
      <h2 className="panel-title" id="dc-solve-title">DC circuit solution</h2>
      {questionText.trim() && <p className="dc-question-prompt">Question: {questionText.trim()}</p>}
      <form onSubmit={handleSubmit}>
        <label className="dc-method-selector">
          Analysis method
          <select value={method} onChange={(event) => setSelection(event.target.value)}>
            {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button className="rc-action-btn rc-action-btn--primary" type="submit">Solve Circuit</button>
        {editable.length > 0 && (
          <details className="dc-value-editor">
            <summary>Edit component values</summary>
            <p>Enter a value with units, such as 220 Ω, 9 V, or 2 mA, then choose Solve Circuit.</p>
            {editable.map((component) => {
              const shown = valueDisplay(component);
              const value = shown.raw ?? shown.text ?? '';
              const fromTerminal = component.currentDirection?.fromTerminal ?? '';
              const edit = draft.get(component.id);
              return (
                <React.Fragment key={component.id}>
                  <label>
                    {component.id}
                    <input type="text"
                      aria-invalid={shown.warning && edit?.value === undefined ? true : undefined}
                      value={edit?.value ?? value}
                      onChange={(event) => updateDraft(component.id, 'value', event.target.value, String(value))}
                    />
                  </label>
                  {component.type === 'current_source' && component.terminals.length === 2 && (
                    <label>
                      {component.id} reference direction
                      <select value={edit?.fromTerminal ?? fromTerminal}
                        onChange={(event) => updateDraft(component.id, 'fromTerminal', event.target.value, fromTerminal)}>
                        <option value="">Confirm arrow direction</option>
                        {component.terminals.map(({ label }, index) => (
                          <option key={label} value={label}>
                            {label} ({component.terminals[index].node}) → {component.terminals[1 - index].label} ({component.terminals[1 - index].node})
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </React.Fragment>
              );
            })}
          </details>
        )}
      </form>
      <div className="dc-solve-results" aria-live="polite">
        {conflict && <p role="status">{conflict}</p>}
        <DcSolveOutput
          graph={graph} result={result} questionText={questionText}
          hasDraft={solveVersion > 0 && hasDraft} onStepChange={onStepChange}
          onShowCircuit={onShowCircuit}
        />
      </div>
    </section>
  );
}
