import React from 'react';
import { ChevronLeft, ChevronRight, Check } from 'lucide-react';

export default function StepExplainer({
  steps,
  activeStep,
  onStepChange,
  isValid
}) {
  if (!isValid || !steps || steps.length === 0) {
    return (
      <div className="panel-card explainer-panel panel-disabled">
        <div className="empty-state-notice">
          <h3 className="empty-title">Calculations Paused</h3>
          <p className="empty-desc">
            Correct circuit parameters in the controls panel to resume step-by-step analysis.
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

  return (
    <div className="panel-card explainer-panel">
      {/* Stepper Navigation Header */}
      <div className="panel-header explainer-header">
        <div className="step-counter-label">
          <span>Step {currentStep.stepNumber} of {totalSteps}</span>
        </div>

        {/* Step Selector Pills */}
        <div className="step-tabs" role="tablist">
          {steps.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = idx < activeStep;
            return (
              <button
                key={step.id}
                role="tab"
                aria-selected={isActive}
                className={`step-tab-btn ${isActive ? 'tab-active' : ''} ${isCompleted ? 'tab-done' : ''}`}
                onClick={() => onStepChange(idx)}
                title={`Jump to ${step.title}`}
              >
                {isCompleted ? <Check size={11} className="tab-check-icon" /> : null}
                <span>Step {idx + 1}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Step Content Body */}
      <div className="explainer-scroll-body">
        <div className="step-heading-group">
          <h3 className="step-title">{currentStep.title}</h3>
          <p className="step-sub">{currentStep.subtitle}</p>
        </div>

        {/* Formula / Math Block */}
        <div className="math-display-card">
          <span className="math-card-label">Formula / Value</span>
          <div className="math-code-value">
            <code>{currentStep.mathText || currentStep.mathEquation}</code>
          </div>
        </div>

        {/* Conceptual Reasoning */}
        <div className="explanation-prose">
          <p>{currentStep.explanation}</p>
        </div>

        {/* Python Reference */}
        <div className="python-reference-card">
          <span className="python-card-label">Python Reference (circuit_calculator.py)</span>
          <code className="python-inline-code">{currentStep.keyTakeaway}</code>
        </div>
      </div>

      {/* Stepper Controls Footer */}
      <div className="explainer-nav-footer">
        <button
          type="button"
          onClick={handlePrev}
          disabled={isFirst}
          className="btn-step-nav btn-step-prev"
        >
          <ChevronLeft size={16} />
          <span>Previous</span>
        </button>

        <span className="nav-keyboard-hint">
          Keys: <kbd>←</kbd> <kbd>→</kbd>
        </span>

        <button
          type="button"
          onClick={handleNext}
          disabled={isLast}
          className="btn-step-nav btn-step-next"
        >
          <span>{isLast ? 'Completed' : 'Next Step'}</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
