/**
 * AnalysisResultPanel — displays the structured circuit recognition output
 * returned by the /api/analyze-image endpoint.
 *
 * Shows loading, error, unsupported-format, and success states.
 * Does NOT replace or affect the existing circuit visualisation.
 */
import React from 'react';
import { Loader2, AlertCircle, CheckCircle2, Info, FileWarning } from 'lucide-react';

// Human-readable labels for enum values coming from the backend.
const CIRCUIT_TYPE_LABELS = {
  series: 'Series',
  parallel: 'Parallel',
  mixed: 'Mixed (series + parallel)',
  unknown: 'Unknown topology',
  not_a_circuit: 'Not a circuit',
};

const COMPONENT_TYPE_LABELS = {
  resistor: 'Resistor',
  battery: 'Battery',
  voltage_source: 'Voltage Source',
  ac_voltage_source: 'AC Voltage Source',
  current_source: 'Current Source',
  wire: 'Wire',
  switch: 'Switch',
  capacitor: 'Capacitor',
  inductor: 'Inductor',
  diode: 'Diode',
  led: 'LED',
  ground: 'Ground',
  ammeter: 'Ammeter',
  voltmeter: 'Voltmeter',
  unknown: 'Unknown Symbol',
};

function ConfidenceDot({ value }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8 ? 'var(--accent-current)' :
    value >= 0.5 ? 'var(--accent-resistance)' :
    'var(--accent-danger)';
  return (
    <span
      className="analysis-confidence"
      style={{ color }}
      title={`Confidence: ${pct}%`}
    >
      {pct}%
    </span>
  );
}

function ComponentCard({ component }) {
  return (
    <div className="analysis-component-card">
      <div className="analysis-component-header">
        <span className="analysis-component-id">{component.id}</span>
        <span className="analysis-component-type">
          {COMPONENT_TYPE_LABELS[component.type] ?? component.type}
        </span>
        <ConfidenceDot value={component.confidence} />
      </div>
      {component.visible_value && (
        <div className="analysis-component-value">
          Value: <strong>{component.visible_value}</strong>
        </div>
      )}
      {component.terminals.length > 0 && (
        <div className="analysis-component-terminals">
          Terminals:{' '}
          {component.terminals.map((t) => (
            <span key={t.label} className="analysis-terminal-badge" title={t.description ?? ''}>
              {t.label}
            </span>
          ))}
        </div>
      )}
      {component.notes && (
        <p className="analysis-component-notes">{component.notes}</p>
      )}
    </div>
  );
}

function ConnectionRow({ connection }) {
  return (
    <div className="analysis-connection-row">
      <span className="analysis-conn-endpoint">{connection.from_component}.{connection.from_terminal}</span>
      <span className="analysis-conn-arrow">→</span>
      <span className="analysis-conn-endpoint">{connection.to_component}.{connection.to_terminal}</span>
      {connection.notes && (
        <span className="analysis-conn-note" title={connection.notes}>⚠</span>
      )}
    </div>
  );
}

export default function AnalysisResultPanel({ analysisState }) {
  const { status, result, error } = analysisState;

  if (status === 'idle') return null;

  // --- Loading state -------------------------------------------------------
  if (status === 'loading') {
    return (
      <div className="analysis-panel analysis-panel--loading">
        <Loader2 size={16} className="analysis-spinner" />
        <span>Analysing circuit image…</span>
      </div>
    );
  }

  // --- SVG / unsupported format state -------------------------------------
  if (status === 'unsupported') {
    return (
      <div className="analysis-panel analysis-panel--warning">
        <FileWarning size={16} className="flex-shrink-0" />
        <div>
          <p className="analysis-panel-title">SVG format not supported by vision API</p>
          <p className="analysis-panel-body">
            The sample circuit is an SVG vector file. The Gemini vision model
            requires a raster image. To analyse your own circuit, upload a{' '}
            <strong>PNG, JPG, or WebP</strong> screenshot or photo instead.
          </p>
        </div>
      </div>
    );
  }

  // --- Error state ---------------------------------------------------------
  if (status === 'error') {
    return (
      <div className="analysis-panel analysis-panel--error">
        <AlertCircle size={16} className="flex-shrink-0" />
        <div>
          <p className="analysis-panel-title">Analysis failed</p>
          <p className="analysis-panel-body">{error}</p>
        </div>
      </div>
    );
  }

  // --- Success state -------------------------------------------------------
  if (status === 'success' && result) {
    const { contains_circuit, circuit_type, components, connections,
            question_text, unclear_details, general_notes } = result;

    return (
      <div className="analysis-panel analysis-panel--success">
        {/* Header row */}
        <div className="analysis-header-row">
          <CheckCircle2 size={15} className="analysis-success-icon" />
          <span className="analysis-header-label">Circuit Recognition</span>
          <span className="analysis-circuit-type-badge">
            {CIRCUIT_TYPE_LABELS[circuit_type] ?? circuit_type}
          </span>
        </div>

        {!contains_circuit && (
          <div className="analysis-not-circuit-notice">
            <Info size={14} />
            <span>No electrical circuit was detected in this image.</span>
          </div>
        )}

        {/* Question text */}
        {question_text && (
          <div className="analysis-section">
            <h4 className="analysis-section-title">Question in image</h4>
            <blockquote className="analysis-question-text">
              {question_text}
            </blockquote>
          </div>
        )}

        {/* Components */}
        {components.length > 0 && (
          <div className="analysis-section">
            <h4 className="analysis-section-title">
              Components ({components.length})
            </h4>
            <div className="analysis-components-list">
              {components.map((c) => (
                <ComponentCard key={c.id} component={c} />
              ))}
            </div>
          </div>
        )}

        {/* Connections */}
        {connections.length > 0 && (
          <div className="analysis-section">
            <h4 className="analysis-section-title">
              Connections ({connections.length})
            </h4>
            <div className="analysis-connections-list">
              {connections.map((conn, i) => (
                <ConnectionRow key={i} connection={conn} />
              ))}
            </div>
          </div>
        )}

        {/* Unclear details */}
        {unclear_details.length > 0 && (
          <div className="analysis-section">
            <h4 className="analysis-section-title analysis-section-title--warn">
              Unclear details
            </h4>
            <ul className="analysis-unclear-list">
              {unclear_details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {/* General notes */}
        {general_notes && (
          <p className="analysis-general-notes">{general_notes}</p>
        )}

        {/* Honest disclaimer */}
        <p className="analysis-disclaimer">
          Recognition only — circuit solving is not performed by this step.
        </p>
      </div>
    );
  }

  return null;
}
