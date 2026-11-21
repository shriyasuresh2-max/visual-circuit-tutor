import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { lessonEquationTex, lessonNumber, lessonSignedQuantityTex } from '../circuit/dcLessonMath.js';
import { dcDisplayContext, displayEquation } from '../circuit/electricalDisplay.js';
import SourceTransformationIllustration from './SourceTransformationIllustration.jsx';

function LessonEquation({ latex, text }) {
  if (latex) {
    try {
      // Inline layout permits breaks between terms. Display-style fractions
      // keep their full height, and KaTeX also emits accessible MathML.
      const html = katex.renderToString(`\\displaystyle ${latex}`, { trust: false, strict: 'error' });
      return <span dangerouslySetInnerHTML={{ __html: html }} />;
    } catch (error) {
      if (!(error instanceof katex.ParseError)) throw error;
    }
  }
  return <span>{text}</span>;
}

function EquationList({ expressions }) {
  return (
    <ul className="dc-lesson-equations">
      {expressions.map(({ latex, expression }, index) => (
        <li key={index}><LessonEquation latex={latex} text={expression} /></li>
      ))}
    </ul>
  );
}

function WorkedEquations({ entries, final = false, results = final ? entries : [], simple = false, primary }) {
  const formulas = [];
  const substitutions = [];
  for (const equation of entries) {
    const { expression } = equation;
    const formula = lessonEquationTex(equation, 'formula');
    const substitution = lessonEquationTex(equation, 'substitution');
    if (formula) formulas.push({ latex: formula, expression });
    if (substitution) substitutions.push({ latex: substitution, expression: equation.substitutionExpression ?? expression });
  }
  const answers = results.map((equation) => ({ latex: lessonEquationTex(equation), expression: equation.expression }));
  const stages = [
    { title: 'Formula', expressions: formulas },
    { title: 'Substitute values', expressions: substitutions },
  ].filter(({ expressions }) => expressions.length > 0);
  return (
    <div className="dc-lesson-box">
      {!simple && stages.length > 0 && <h5>Part B — Work it out</h5>}
      {stages.map(({ title, expressions }, index) => (
        <div className="dc-lesson-stage" key={title}>
          <h6>{simple ? title : `Stage ${index + 1} — ${title}`}</h6>
          <EquationList expressions={expressions} />
        </div>
      ))}
      {primary && <div className="dc-lesson-stage dc-lesson-result">
        <strong>Requested result</strong>
        <EquationList expressions={[{ latex: lessonEquationTex(primary), expression: primary.expression }]} />
      </div>}
      {answers.length > 0 && <div className="dc-lesson-result">
        <strong>{simple ? final && !primary ? 'Final answer' : 'Result' : stages.length ? `Stage ${stages.length + 1} — Final answer` : 'Final answer'}</strong>
        <EquationList expressions={answers} />
      </div>}
    </div>
  );
}

function EquivalentIllustration({ fromNodeId, toNodeId, equivalentIndex, resistance, memberNames }) {
  return (
    <figure className="dc-equivalent-illustration">
      <figcaption>{memberNames.join(' + ')} → equivalent {equivalentIndex} ({lessonNumber(resistance)} Ω)</figcaption>
      <svg viewBox="0 0 240 55" width="100%" height="55" role="img"
        aria-label={`Intermediate equivalent resistor between ${fromNodeId} and ${toNodeId}`}>
        <path d="M 28 32 H 92 L 99 22 L 106 42 L 113 22 L 120 42 L 127 22 L 134 42 L 141 22 L 148 32 H 212"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="28" cy="32" r="3" fill="currentColor" />
        <circle cx="212" cy="32" r="3" fill="currentColor" />
        <text x="28" y="19" fontSize="11" fill="currentColor" textAnchor="middle">{fromNodeId}</text>
        <text x="212" y="19" fontSize="11" fill="currentColor" textAnchor="middle">{toNodeId}</text>
      </svg>
    </figure>
  );
}

function RemainingReductionCircuit({ branches }) {
  return (
    <figure className="dc-reduction-network">
      <figcaption><strong>Remaining circuit</strong> · Matching node labels are electrically connected.</figcaption>
      <ul>
        {branches.map(({ id, name, fromNodeId, toNodeId, resistance, sourceVoltage, sourceCurrent }) => (
          <li key={id}>
            <span>{name} · {resistance != null ? `${lessonNumber(resistance)} Ω`
              : sourceVoltage != null ? `${lessonNumber(sourceVoltage)} V` : `${lessonNumber(sourceCurrent)} A`}</span>
            <div className="dc-reduction-network-branch">
              <span>{fromNodeId}</span>
              <svg viewBox="0 0 64 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <path d={resistance != null ? 'M2 12H16l4-5 4 10 4-10 4 10 4-10 4 10 4-10 4 5H62' : 'M2 12H22m20 0H62'} />
                {resistance == null && <circle cx="32" cy="12" r="10" />}
                {sourceVoltage != null && <path d="M25 12h5m-2.5-2.5v5M34 12h5" />}
                {sourceCurrent != null && <path d="M26 12h12m-4-4 4 4-4 4" />}
              </svg>
              <span>{toNodeId}</span>
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function SourceStates({ active, inactive }) {
  return (
    <ul className="dc-superposition-states" aria-label="Single-source circuit states">
      <li><strong>{active.componentId} active</strong> · {lessonNumber(active.value)} {active.unit} ({active.fromTerminal} → {active.toTerminal})</li>
      {inactive.map(({ componentId, replacement }) => (
        <li key={componentId}>{componentId} · {replacement === 'short' ? 'Ideal short (0 V)' : 'Ideal open (0 A)'}</li>
      ))}
    </ul>
  );
}

function ContributionTable({ sourceIds, entries }) {
  const cell = (value, unit) => <LessonEquation latex={lessonSignedQuantityTex(value, unit)}
    text={`${value > 0 ? '+' : ''}${lessonNumber(value)} ${unit}`} />;
  return (
    <div className="dc-contribution-table" role="region" aria-label="Signed source contributions" tabIndex={0}>
      <table>
        <caption>Signed source contributions</caption>
        <thead><tr><th scope="col">Measured quantity</th>
          {sourceIds.map((id) => <th scope="col" key={id}>{id}</th>)}
          <th scope="col">Combined</th><th scope="col">Direct MNA</th>
        </tr></thead>
        <tbody>{entries.map(({ id, label, quantity, unit, terms, value, directValue }) => (
          <tr key={`${quantity}-${id}`}><th scope="row">{label}</th>
            {terms.map(({ sourceId, value: contribution }) => <td key={sourceId}>{cell(contribution, unit)}</td>)}
            <td>{cell(value, unit)}</td><td>{cell(directValue, unit)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function DcLessonStepView({ lesson, index, onMove, displaySolution, superposition, summary, onShowCircuit }) {
  const step = lesson.steps[index];
  const nodal = lesson.method === 'modified-nodal-analysis';
  const mesh = lesson.method === 'mesh-current-analysis';
  const reduction = lesson.method === 'series-parallel-reduction';
  const transformation = lesson.method === 'source-transformation';
  const superpositionLesson = lesson.method === 'superposition';
  const simple = nodal || mesh || reduction || transformation || superpositionLesson;
  const headingId = useId();
  const lessonRef = useRef(null);
  const previousStep = useRef(null);
  useLayoutEffect(() => {
    const previous = previousStep.current;
    previousStep.current = { lesson, index };
    if (!previous || (previous.lesson === lesson && previous.index === index)) return;

    const section = lessonRef.current;
    const panel = section.closest('.dc-solve-panel');
    if (panel && getComputedStyle(panel).overflowY === 'auto') {
      // Change only the desktop panel's scroll position and keep its nav in view.
      const lessonTop = panel.scrollTop + section.getBoundingClientRect().top - panel.getBoundingClientRect().top;
      panel.scrollTop = previous.lesson !== lesson ? 0
        : Math.min(panel.scrollTop, lessonTop);
    } else if (section.getBoundingClientRect().top < 0) {
      // In the stacked layout the document is the scrolling surface.
      section.scrollIntoView({ block: 'start' });
    }
  }, [lesson, index]);
  const contexts = React.useMemo(() => ({ read: dcDisplayContext(displaySolution),
    cases: new Map(superposition?.contributions.map((entry) => [entry.activeSourceId, dcDisplayContext(entry)])),
    direct: superposition ? dcDisplayContext(superposition.directResult) : undefined,
  }), [displaySolution, superposition]);
  const read = contexts.cases.get(step.sourceCase?.active.componentId) ?? contexts.read;
  const present = (equation) => displayEquation(equation, read, contexts.cases, contexts.direct);
  return (
    <section className="dc-lesson" id="workspace-lesson" ref={lessonRef} aria-labelledby={headingId}>
      <h3 id={headingId}>Step-by-Step Solution</h3>
      <nav className="dc-lesson-controls" aria-label="Solution steps">
        <button type="button" className="rc-action-btn" disabled={index === 0} onClick={() => onMove(-1)}>
          Previous Step
        </button>
        <div className="dc-lesson-progress">
          <span>Step {index + 1} of {lesson.steps.length}</span>
          {onShowCircuit && <a className="dc-lesson-circuit-link" href="#workspace-circuit" onClick={onShowCircuit}>View circuit</a>}
        </div>
        <button type="button" className="rc-action-btn" disabled={index === lesson.steps.length - 1} onClick={() => onMove(1)}>
          Next Step
        </button>
      </nav>
      <div className="dc-lesson-content" aria-live="polite">
        <h4>{step.title}</h4>
        {(!superpositionLesson || index === lesson.steps.length - 1) && summary}
        {simple ? <p className="dc-nodal-explanation">{step.explanation}</p>
          : <div className="dc-lesson-box">
            <h5>Part A — What are we finding?</h5>
            <p>{step.explanation}</p>
          </div>}
        {step.sourceIllustration && <SourceTransformationIllustration step={step.sourceIllustration} />}
        {transformation && step.sourceNote && <p className="dc-nodal-explanation">{step.sourceNote}</p>}
        {step.sourceCase && <SourceStates {...step.sourceCase} />}
        {superpositionLesson && step.referenceNote && <p className="dc-nodal-explanation">{step.referenceNote}</p>}
        {simple && step.workedEquations ? <WorkedEquations entries={step.workedEquations.map(present)}
          results={step.finalAnswer?.filter((equation) => equation !== step.primaryResult).map(present)}
          primary={step.primaryResult && present(step.primaryResult)} final={index === lesson.steps.length - 1} simple />
          : step.finalAnswer ? <WorkedEquations entries={step.finalAnswer.map(present)} final />
          : step.workedEquations ? <WorkedEquations entries={step.workedEquations.map(present)} />
            : step.equations.length > 0 && (
          <div className="dc-lesson-box">
            {!simple && <h5>Part B — Work it out</h5>}
            <EquationList expressions={step.equations.map(present).map((equation) => ({
              latex: lessonEquationTex(equation), expression: equation.expression,
            }))} />
          </div>
        )}
        {step.illustration && <EquivalentIllustration {...step.illustration} />}
        {superpositionLesson && step.powerNote && <p className="dc-nodal-explanation">{step.powerNote}</p>}
        {superpositionLesson && step.caseDerivation?.length > 0 && <details className="dc-nodal-details">
          <summary>How this isolated circuit was solved</summary>
          {step.caseDerivation.map((substep) => <div className="dc-lesson-stage" key={substep.id}>
            <h6>{substep.title}</h6>
            <p>{substep.explanation}</p>
            {substep.workedEquations ? <WorkedEquations simple entries={substep.workedEquations.map(present)}
              results={substep.finalAnswer?.map(present)} />
              : <EquationList expressions={substep.equations.map(present).map((equation) => ({
                latex: lessonEquationTex(equation), expression: equation.expression,
              }))} />}
          </div>)}
        </details>}
        {step.contributionTable && <details className="dc-nodal-details">
          <summary>Compare contributions with the original solve</summary>
          <ContributionTable {...step.contributionTable} entries={step.contributionTable.entries.map(present)} />
        </details>}
        {reduction && step.remainingNetwork && <RemainingReductionCircuit branches={step.remainingNetwork} />}
        {reduction && step.nextMethodHint && <p>{step.nextMethodHint}</p>}
        {transformation && step.transformationIssues?.length > 0 && <details className="dc-nodal-details">
          <summary>Why these sources were left unchanged</summary>
          <ul>{step.transformationIssues.map((message, index) => <li key={index}>{message}</li>)}</ul>
        </details>}
        {mesh && step.showSourcePolarity && <details className="dc-nodal-details">
          <summary>Voltage source signs</summary>
          <p>Count the source voltage as a drop from its positive terminal to its negative terminal. Reverse the sign when the loop crosses it the other way.</p>
        </details>}
        {mesh && step.showMeshDirection && <details className="dc-nodal-details">
          <summary>Loop reference path</summary>
          <ol>{step.meshRegion[0].boundary.map(({ componentId, fromNodeId, toNodeId }, edge) => (
            <li key={edge}>{fromNodeId} → {toNodeId} through {componentId}</li>
          ))}</ol>
        </details>}
        {simple && step.directionEquations && <details className="dc-nodal-details">
          <summary>Current reference directions</summary>
          <EquationList expressions={step.directionEquations.map((equation) => ({ latex: lessonEquationTex(equation), expression: equation.expression }))} />
        </details>}
        {simple && step.allResults && <details className="dc-nodal-details">
          <summary>{transformation ? 'Original branch values from Nodal Analysis'
            : reduction ? 'All original resistor values' : mesh ? 'Other solved voltages and currents' : 'All solved voltages and currents'}</summary>
          {step.extraEquations.length > 0 && <WorkedEquations simple entries={step.extraEquations.map(present)}
            results={superpositionLesson ? step.extraEquations.map(present) : undefined} />}
          <EquationList expressions={step.allResults.map(present).map((equation) => ({ latex: lessonEquationTex(equation), expression: equation.expression }))} />
        </details>}
      </div>
    </section>
  );
}

export default function DcLessonSteps({ lesson, onStepChange, displaySolution, superposition, summary, onShowCircuit }) {
  const [position, setPosition] = useState({ lesson, index: 0 });
  const index = position.lesson === lesson ? position.index : 0;
  const step = lesson.steps[index];
  useLayoutEffect(() => {
    onStepChange?.(step);
    return () => onStepChange?.(null);
  }, [onStepChange, step]);
  function move(delta) {
    setPosition((previous) => {
      const current = previous.lesson === lesson ? previous.index : 0;
      return { lesson, index: Math.max(0, Math.min(lesson.steps.length - 1, current + delta)) };
    });
  }
  return <DcLessonStepView lesson={lesson} index={index} onMove={move} displaySolution={displaySolution}
    superposition={superposition} summary={summary} onShowCircuit={onShowCircuit} />;
}
