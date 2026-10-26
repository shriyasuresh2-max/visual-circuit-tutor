import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function WorkspaceParametersStrip({
  voltage,
  resistance,
  onVoltageChange,
  onResistanceChange,
  error
}) {
  return (
    <section className="params-strip-container" aria-label="Circuit parameter controls">
      <div className="params-strip-inner">
        <span className="params-strip-label">Circuit Parameters:</span>

        {/* Voltage Source Control */}
        <div className="param-control-group">
          <label htmlFor="param-voltage" className="param-title">
            Source Voltage (<span className="text-voltage">V</span>)
          </label>
          <div className="param-inputs-row">
            <input
              id="param-voltage"
              type="number"
              step="any"
              value={voltage}
              onChange={(e) => onVoltageChange(e.target.value)}
              className="param-num-input"
              aria-label="Voltage in Volts"
            />
            <span className="param-unit-symbol">V</span>
            <input
              type="range"
              min="1"
              max="48"
              step="1"
              value={Number(voltage) || 12}
              onChange={(e) => onVoltageChange(e.target.value)}
              className="param-range-slider slider-voltage"
              aria-label="Voltage range slider"
            />
            <span className="param-range-bounds">1–48 V</span>
          </div>
        </div>

        <div className="params-strip-divider" />

        {/* Circuit Resistance Control */}
        <div className="param-control-group">
          <label htmlFor="param-resistance" className="param-title">
            Load Resistance (<span className="text-resistance">R</span>)
          </label>
          <div className="param-inputs-row">
            <input
              id="param-resistance"
              type="number"
              step="any"
              value={resistance}
              onChange={(e) => onResistanceChange(e.target.value)}
              className={`param-num-input ${error ? 'input-error' : ''}`}
              aria-label="Resistance in Ohms"
            />
            <span className="param-unit-symbol">Ω</span>
            <input
              type="range"
              min="0.5"
              max="50"
              step="0.5"
              value={Number(resistance) > 0 ? Number(resistance) : 0.5}
              onChange={(e) => onResistanceChange(e.target.value)}
              className="param-range-slider slider-resistance"
              aria-label="Resistance range slider"
            />
            <span className="param-range-bounds">0.5–50 Ω (R &gt; 0)</span>
          </div>
        </div>
      </div>

      {/* Inline Parameter Error Banner */}
      {error && (
        <div className="params-inline-error" role="alert">
          <AlertTriangle size={15} className="error-icon" />
          <span className="error-text">{error}</span>
        </div>
      )}
    </section>
  );
}
