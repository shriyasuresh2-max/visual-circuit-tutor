import React from 'react';

export default function MetricsSummary({ circuitResult }) {
  const { formatted, isValid } = circuitResult;

  const metrics = [
    {
      id: 'voltage',
      label: 'Voltage (V)',
      value: formatted.voltage,
      className: 'metric-v'
    },
    {
      id: 'resistance',
      label: 'Resistance (R)',
      value: formatted.resistance,
      className: 'metric-r'
    },
    {
      id: 'current',
      label: 'Current (I)',
      value: isValid ? formatted.current : '—',
      className: 'metric-i'
    },
    {
      id: 'power',
      label: 'Power (P)',
      value: isValid ? formatted.power : '—',
      className: 'metric-p'
    }
  ];

  return (
    <div className="panel-card metrics-panel">
      <div className="panel-header">
        <h2 className="panel-title">Calculated Values</h2>
      </div>

      <div className="metrics-compact-grid">
        {metrics.map((m) => (
          <div key={m.id} className={`metric-tile ${m.className}`}>
            <span className="metric-tile-label">{m.label}</span>
            <span className="metric-tile-val">{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
