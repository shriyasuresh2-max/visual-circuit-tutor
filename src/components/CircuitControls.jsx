import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function CircuitControls({
  voltage,
  resistance,
  onVoltageChange,
  onResistanceChange,
  error
}) {
  const handleVoltageInput = (e) => {
    onVoltageChange(e.target.value);
  };

  const handleResistanceInput = (e) => {
    onResistanceChange(e.target.value);
  };

  return (
    <div className="panel-card controls-panel">
      <div className="panel-header">
        <h2 className="panel-title">Circuit Parameters</h2>
      </div>

      <div className="controls-stack">
        {/* Voltage Source Input */}
        <div className="control-field">
          <div className="control-label-row">
            <label htmlFor="voltage-input" className="control-label">
              Voltage Source (<span className="text-voltage">V</span>)
            </label>
            <span className="control-value-readout">{voltage} V</span>
          </div>

          <div className="input-slider-pair">
            <input
              id="voltage-input"
              type="number"
              step="any"
              value={voltage}
              onChange={handleVoltageInput}
              className="control-num-input"
              placeholder="12"
              aria-label="Voltage in Volts"
            />
            <input
              type="range"
              min="1"
              max="48"
              step="1"
              value={Number(voltage) || 12}
              onChange={handleVoltageInput}
              className="control-range-slider slider-voltage"
              aria-label="Voltage slider"
            />
          </div>
          <span className="field-hint">Range: 1 V to 48 V</span>
        </div>

        {/* Resistance Input */}
        <div className="control-field">
          <div className="control-label-row">
            <label htmlFor="resistance-input" className="control-label">
              Resistance (<span className="text-resistance">R</span>)
            </label>
            <span className="control-value-readout">{resistance} Ω</span>
          </div>

          <div className="input-slider-pair">
            <input
              id="resistance-input"
              type="number"
              step="any"
              value={resistance}
              onChange={handleResistanceInput}
              className={`control-num-input ${error ? 'input-invalid' : ''}`}
              placeholder="4"
              aria-label="Resistance in Ohms"
            />
            <input
              type="range"
              min="0.5"
              max="50"
              step="0.5"
              value={Number(resistance) > 0 ? Number(resistance) : 0.5}
              onChange={handleResistanceInput}
              className="control-range-slider slider-resistance"
              aria-label="Resistance slider"
            />
          </div>
          <span className="field-hint">Range: 0.5 Ω to 50 Ω (R &gt; 0)</span>
        </div>
      </div>

      {/* Validation Error Display */}
      {error && (
        <div className="validation-alert" role="alert">
          <AlertTriangle size={16} className="alert-icon" />
          <div className="alert-body">
            <strong className="alert-heading">Parameter Error</strong>
            <p className="alert-text">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}
