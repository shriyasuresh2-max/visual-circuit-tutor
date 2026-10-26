import React from 'react';
import { RotateCcw } from 'lucide-react';

export default function Header({ onResetDefaults }) {
  return (
    <header className="app-header">
      <div className="header-brand">
        <h1 className="header-title">Visual Circuit Tutor</h1>
        <span className="header-separator">/</span>
        <span className="header-topic">DC Series Circuit Analysis</span>
      </div>

      <div className="header-actions">
        <button
          type="button"
          onClick={onResetDefaults}
          className="btn-header-reset"
          title="Reset circuit to default values (12 V / 4 Ω)"
        >
          <RotateCcw size={14} />
          <span>Reset Circuit</span>
        </button>
      </div>
    </header>
  );
}
