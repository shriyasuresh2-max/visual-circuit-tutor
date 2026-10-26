import React from 'react';
import { RotateCcw, ArrowLeft, Image as ImageIcon } from 'lucide-react';

export default function WorkspaceHeader({
  onNewProblem,
  onResetDefaults,
  hasReferenceImage,
  isReferenceOpen,
  onToggleReference
}) {
  return (
    <header className="workspace-header">
      <div className="workspace-brand-col">
        <h1 className="workspace-brand-title">Visual Circuit Tutor</h1>
        <span className="workspace-topic-tag">DC Series Circuit Analysis</span>
      </div>

      <div className="workspace-actions-col">
        {hasReferenceImage && (
          <button
            type="button"
            onClick={onToggleReference}
            className={`btn-workspace-action ${isReferenceOpen ? 'action-active' : ''}`}
            title="Toggle reference textbook diagram"
          >
            <ImageIcon size={14} />
            <span>{isReferenceOpen ? 'Hide Reference' : 'Reference Image'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onResetDefaults}
          className="btn-workspace-action"
          title="Reset voltage and resistance to 12 V and 4 Ω"
        >
          <RotateCcw size={14} />
          <span>Reset Circuit</span>
        </button>

        <button
          type="button"
          onClick={onNewProblem}
          className="btn-workspace-action btn-new-problem"
          title="Return to upload page to start a new problem"
        >
          <ArrowLeft size={14} />
          <span>New Problem</span>
        </button>
      </div>
    </header>
  );
}
