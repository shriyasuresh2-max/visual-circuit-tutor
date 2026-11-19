import React, { useId, useLayoutEffect, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { lessonEquationTex } from '../circuit/dcLessonMath.js';

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

function AnswerWork({ entries }) {
  const formulas = [];
  const substitutions = [];
  const results = [];
  for (const equation of entries) {
    const { expression } = equation;
    const formula = lessonEquationTex(equation, 'formula');
    const substitution = lessonEquationTex(equation, 'substitution');
    if (formula) formulas.push({ latex: formula, expression });
    if (substitution) substitutions.push({ latex: substitution, expression });
    results.push({ latex: lessonEquationTex(equation), expression });
  }
  const stages = [
    { title: 'Formula', expressions: formulas },
    { title: 'Substitute values', expressions: substitutions },
  ].filter(({ expressions }) => expressions.length > 0);
  return (
    <div className="dc-lesson-box">
      {stages.length > 0 && <h5>Part B — Work it out</h5>}
      {stages.map(({ title, expressions }, index) => (
        <div className="dc-lesson-stage" key={title}>
          <h6>Stage {index + 1} — {title}</h6>
          <EquationList expressions={expressions} />
        </div>
      ))}
      <div className="dc-lesson-result">
        <strong>{stages.length > 0 ? `Stage ${stages.length + 1} — Final answer` : 'Final answer'}</strong>
        <EquationList expressions={results} />
      </div>
    </div>
  );
}

export function DcLessonStepView({ lesson, index, onMove }) {
  const step = lesson.steps[index];
  const headingId = useId();
  return (
    <section className="dc-lesson" aria-labelledby={headingId}>
      <h3 id={headingId}>Step-by-Step Solution</h3>
      <nav className="dc-lesson-controls" aria-label="Solution steps">
        <button type="button" className="rc-action-btn" disabled={index === 0} onClick={() => onMove(-1)}>
          Previous Step
        </button>
        <span>Step {index + 1} of {lesson.steps.length}</span>
        <button type="button" className="rc-action-btn" disabled={index === lesson.steps.length - 1} onClick={() => onMove(1)}>
          Next Step
        </button>
      </nav>
      <div className="dc-lesson-content" aria-live="polite">
        <h4>{step.title}</h4>
        <div className="dc-lesson-box">
          <h5>Part A — What are we finding?</h5>
          <p>{step.explanation}</p>
        </div>
        {step.finalAnswer ? <AnswerWork entries={step.finalAnswer} /> : step.equations.length > 0 && (
          <div className="dc-lesson-box">
            <h5>Part B — Work it out</h5>
            <EquationList expressions={step.equations.map((equation) => ({
              latex: lessonEquationTex(equation), expression: equation.expression,
            }))} />
          </div>
        )}
      </div>
    </section>
  );
}

export default function DcLessonSteps({ lesson, onStepChange }) {
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
  return <DcLessonStepView lesson={lesson} index={index} onMove={move} />;
}
