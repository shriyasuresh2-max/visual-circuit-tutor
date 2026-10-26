import React from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function StepExplainer({
  steps,
  activeStep,
  onStepChange,
  isValid
}) {
  if (!isValid || !steps || steps.length === 0) {
    return (
      <div className="explainer-card card-disabled">
        <div className="explainer-empty-notice">
          <h3 className="empty-title">Circuit Calculation Paused</h3>
          <p className="empty-desc">
            Please resolve the parameter errors in the top controls to resume step-by-step circuit analysis.
          </p>
        </div>
      </div>
    );
  }

  const currentStep = steps[activeStep] || steps[0];
  const totalSteps = steps.length;
  const isFirst = activeStep === 0;
  const isLast = activeStep === totalSteps - 1;

  const handlePrev = () => {
    if (!isFirst) {
      onStepChange(activeStep - 1);
    }
  };

  const handleNext = () => {
    if (!isLast) {
      onStepChange(activeStep + 1);
    }
  };

  const { partA, partB, partC } = currentStep;

  return (
    <div className="explainer-card" aria-label="Step-by-step circuit explanation">
      {/* 
        Arrow Navigation Bar:
        ← Previous       Step X of 4       Next →
        "Next" is displayed on EVERY step (including final step, where it is disabled)
      */}
      <div className="explainer-nav-bar">
        <button
          type="button"
          onClick={handlePrev}
          disabled={isFirst}
          className="btn-step-arrow btn-step-arrow-prev"
          aria-label="Previous step"
          title={isFirst ? 'First step' : 'Previous step (← key)'}
        >
          <ArrowLeft size={15} />
          <span>Previous</span>
        </button>

        <div className="step-indicator-group">
          <span className="step-indicator-text">
            Step {currentStep.stepNumber} of {totalSteps}
          </span>
          <span className="step-keyboard-pill" title="You can also use the Left and Right arrow keys on your keyboard">
            <kbd>←</kbd> <kbd>→</kbd>
          </span>
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={isLast}
          className="btn-step-arrow btn-step-arrow-next"
          aria-label="Next step"
          title={isLast ? 'Final step reached' : 'Next step (→ key)'}
        >
          <span>Next</span>
          <ArrowRight size={15} />
        </button>
      </div>

      {/* Main Educational Explanation Body: 3 Clear Parts */}
      <div className="explainer-body">
        {/* Step Title Header */}
        <div className="step-header-block">
          <h2 className="step-main-heading">{currentStep.title}</h2>
        </div>

        {/* Part A — What Are We Finding? */}
        <div className="explanation-section section-part-a">
          <h3 className="section-heading">Part A — What Are We Finding?</h3>
          <p className="part-a-text">{partA}</p>
        </div>

        {/* Part B — Work It Out */}
        <div className="explanation-section section-part-b">
          <h3 className="section-heading">Part B — Work It Out</h3>
          <div className="calculation-sequence">
            {/* Stage 1: Formula */}
            <div className="calc-stage">
              <div className="stage-title-row">
                <span className="stage-badge">Stage 1</span>
                <span className="stage-name">{partB.stage1Title.replace(/^Stage 1:\s*/, '')}</span>
              </div>
              <div className="stage-math-box">
                <code>{partB.stage1Formula}</code>
              </div>
              {partB.stage1Note && <p className="stage-desc">{partB.stage1Note}</p>}
            </div>

            {/* Stage 2: Substitute the known values */}
            <div className="calc-stage">
              <div className="stage-title-row">
                <span className="stage-badge">Stage 2</span>
                <span className="stage-name">{partB.stage2Title.replace(/^Stage 2:\s*/, '')}</span>
              </div>
              <div className="stage-math-box">
                <code>{partB.stage2Formula}</code>
              </div>
              {partB.stage2Note && <p className="stage-desc">{partB.stage2Note}</p>}
            </div>

            {/* Stage 3: Calculate the answer */}
            <div className="calc-stage stage-final-answer">
              <div className="stage-title-row">
                <span className="stage-badge stage-badge-result">Stage 3</span>
                <span className="stage-name">{partB.stage3Title.replace(/^Stage 3:\s*/, '')}</span>
              </div>
              <div className="stage-math-box answer-highlight-box">
                <code>{partB.stage3Formula}</code>
              </div>
              {partB.stage3Note && <p className="stage-desc">{partB.stage3Note}</p>}
            </div>
          </div>
        </div>

        {/* Part C — What This Means */}
        <div className="explanation-section section-part-c">
          <h3 className="section-heading">Part C — What This Means</h3>
          <p className="part-c-text">{partC}</p>
        </div>
      </div>
    </div>
  );
}
