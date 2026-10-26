import React from 'react';

export default function WorkspaceCalculatedStrip({ circuitResult }) {
  const { formatted, isValid } = circuitResult;

  return (
    <section className="calc-strip-container" aria-label="Calculated circuit quantities">
      <div className="calc-strip-inner">
        <span className="calc-strip-heading">Calculated Values:</span>

        {/* Source Voltage */}
        <div className="calc-item item-voltage">
          <span className="calc-item-name">Voltage (V):</span>
          <span className="calc-item-data">{formatted.voltage}</span>
        </div>

        <span className="calc-dot-sep">•</span>

        {/* Circuit Resistance */}
        <div className="calc-item item-resistance">
          <span className="calc-item-name">Resistance (R):</span>
          <span className="calc-item-data">{formatted.resistance}</span>
        </div>

        <span className="calc-dot-sep">•</span>

        {/* Total Current */}
        <div className="calc-item item-current">
          <span className="calc-item-name">Current (I = V / R):</span>
          <span className="calc-item-data">{isValid ? formatted.current : '—'}</span>
        </div>

        <span className="calc-dot-sep">•</span>

        {/* Power Dissipated */}
        <div className="calc-item item-power">
          <span className="calc-item-name">Power (P = V × I):</span>
          <span className="calc-item-data">{isValid ? formatted.power : '—'}</span>
        </div>
      </div>
    </section>
  );
}
