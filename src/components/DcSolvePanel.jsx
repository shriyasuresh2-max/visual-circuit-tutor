import React, { useMemo, useState } from 'react';
import { solveDcCircuit } from '../circuit/dcSolver.js';
import { valueDisplay } from '../circuit/componentValue.js';
import { answerDcQuestion, parseDcQuestion } from '../circuit/dcQuestions.js';
import { buildDcLesson } from '../circuit/dcLesson.js';
import DcLessonSteps from './DcLessonSteps.jsx';

const editableTypes = new Set(['resistor', 'battery', 'voltage_source']);

function quantity(value, unit) {
  const magnitude = Math.abs(value);
  if (magnitude === 0) return `0 ${unit}`;
  const number = magnitude < 1e-4 || magnitude >= 1e7
    ? value.toExponential(3)
    : String(Number(value.toPrecision(5)));
  return `${number} ${unit}`;
}

function current(value) {
  return value !== 0 && Math.abs(value) < 1
    ? quantity(value * 1000, 'mA')
    : quantity(value, 'A');
}

function DcSolveIssues({ issues }) {
  return (
    <div className="dc-solve-issues" role="alert">
      <h3>Circuit could not be solved</h3>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${index}`}>
            {issue.message}
            {issue.nodeIds?.length > 0 && <> Nodes: {issue.nodeIds.join(', ')}.</>}
            {issue.diagnostics?.length > 0 && (
              <ul>
                {issue.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionAnswer({ answer, result }) {
  const { kind, branch, value, node, message } = answer;
  switch (kind) {
    case 'unsupported':
      return <p role="status">{message}</p>;
    case 'node-voltage':
      return (
        <>
          <strong>{node.id}: {quantity(node.voltage, 'V')}</strong>
          <p>MNA finds this potential relative to {result.referenceNodeId} (0 V).</p>
        </>
      );
    case 'general':
      return <p>Modified nodal analysis balances current at each node and applies the voltage-source constraints.</p>;
    case 'node-voltages':
      return (
        <>
          <p>Voltages are relative to {result.referenceNodeId} (0 V).</p>
          <ul>
            {result.nodes.map(({ id, voltage }) => <li key={id}>{id}: {quantity(voltage, 'V')}</li>)}
          </ul>
        </>
      );
    case 'branch-currents':
      return (
        <>
          <ul>
            {result.branches.map(({ componentId, fromTerminal, toTerminal, current: amps }) => (
              <li key={componentId}>{componentId} ({fromTerminal} → {toTerminal}): {current(amps)}</li>
            ))}
          </ul>
          <p>MNA solves source currents directly and uses I = ΔV ÷ R for resistors. Positive current follows the terminal arrow.</p>
        </>
      );
    case 'resistor-voltage': {
      const from = result.nodes.find((entry) => entry.id === branch.fromNodeId).voltage;
      const to = result.nodes.find((entry) => entry.id === branch.toNodeId).voltage;
      return (
        <>
          <strong>Voltage across {branch.componentId}: {quantity(value, 'V')}</strong>
          <p>Subtract the voltage at {branch.toTerminal} from the voltage at {branch.fromTerminal}: {quantity(from, 'V')} − ({quantity(to, 'V')}).</p>
        </>
      );
    }
    case 'resistor-power':
      return (
        <>
          <strong>Power dissipated by {branch.componentId}: {quantity(value, 'W')}</strong>
          <p>P = ΔV × I = {quantity(branch.voltage, 'V')} × ({current(branch.current)}). Both signs use {branch.fromTerminal} → {branch.toTerminal}.</p>
        </>
      );
    case 'source-supply':
      return (
        <>
          <strong>Current supplied by {branch.componentId}: {current(value)}</strong>
          <p>MNA gives {current(branch.current)} into the positive terminal. Supplied current reverses that sign, so positive means the source delivers current from its positive terminal.</p>
        </>
      );
    case 'branch-current':
      return (
        <>
          <strong>Current through {branch.componentId}: {current(value)}</strong>
          {branch.resistance != null ? (
            <p>I = ΔV ÷ R = {quantity(branch.voltage, 'V')} ÷ {quantity(branch.resistance, 'Ω')}. Positive current flows {branch.fromTerminal} → {branch.toTerminal}.</p>
          ) : (
            <p>MNA solves this source current directly. Positive current flows {branch.fromTerminal} → {branch.toTerminal} through the source.</p>
          )}
        </>
      );
    default:
      return null;
  }
}

export function DcSolveOutput({ graph, result, questionText = '', hasDraft = false, onStepChange }) {
  const intent = useMemo(() => parseDcQuestion(questionText), [questionText]);
  const hasQuestion = Boolean(questionText.trim());
  const lesson = useMemo(() => (
    graph && result?.ok && !hasDraft ? buildDcLesson(graph, result, intent) : null
  ), [graph, result, intent, hasDraft]);
  if (hasDraft) return <p>Values changed. Solve Circuit to update the results.</p>;
  if (!result) return null;
  if (!result.ok) return <DcSolveIssues issues={result.issues} />;
  return (
    <>
      {hasQuestion && (
        <section className="dc-question-answer" aria-label="Question answer">
          <h3>Answer</h3>
          <QuestionAnswer answer={answerDcQuestion(intent, result)} result={result} />
        </section>
      )}
      {lesson?.ok && <DcLessonSteps lesson={lesson} onStepChange={onStepChange} />}
    </>
  );
}

export default function DcSolvePanel({ graph, onApplyValues, questionText = '', onStepChange }) {
  const [solveVersion, setSolveVersion] = useState(0);
  const [draft, setDraft] = useState(() => new Map());
  const hasDraft = draft.size > 0;
  const result = useMemo(() => (
    solveVersion > 0 && !hasDraft ? solveDcCircuit(graph) : null
  ), [graph, solveVersion, hasDraft]);
  const editable = graph.components.filter((component) => editableTypes.has(component.type));

  function handleSubmit(event) {
    event.preventDefault();
    if (hasDraft) {
      const updates = new Map(editable
        .filter((component) => draft.has(component.id))
        .map(({ id }) => [id, draft.get(id).trim() || null]));
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
        <button className="rc-action-btn rc-action-btn--primary" type="submit">Solve Circuit</button>
        {editable.length > 0 && (
          <details className="dc-value-editor">
            <summary>Edit component values</summary>
            <p>Enter a value with units, such as 220 Ω or 9 V, then choose Solve Circuit.</p>
            {editable.map((component) => {
              const shown = valueDisplay(component);
              const value = shown.raw ?? shown.text ?? '';
              return (
                <label key={component.id}>
                  {component.id}
                  <input
                    type="text"
                    aria-invalid={shown.warning && !draft.has(component.id) ? true : undefined}
                    value={draft.get(component.id) ?? value}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDraft((previous) => {
                        const updated = new Map(previous);
                        if (next === String(value)) updated.delete(component.id);
                        else updated.set(component.id, next);
                        return updated;
                      });
                    }}
                  />
                </label>
              );
            })}
          </details>
        )}
      </form>
      <div className="dc-solve-results" aria-live="polite">
        <DcSolveOutput
          graph={graph} result={result} questionText={questionText}
          hasDraft={solveVersion > 0 && hasDraft} onStepChange={onStepChange}
        />
      </div>
    </section>
  );
}
