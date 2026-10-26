import React from 'react';

/**
 * Technical SVG Schematic of a DC Series Circuit
 * 
 * Provides an engineering-grade vector visualization:
 * - Ideal DC Voltage Source with polarity symbols (+ / −)
 * - ANSI standard zigzag resistor
 * - Closed-loop conductors with directional conventional current arrows
 * - Synchronized step-based visual focus without distracting neon glows
 */
export default function CircuitDiagram({
  circuitResult,
  activeStep,
  onSelectStep
}) {
  const { formatted, isValid, current } = circuitResult;
  const isCurrentFlowing = isValid && current !== null && current !== 0;

  const isSourceActive = activeStep === 0;
  const isResistorActive = activeStep === 1;
  const isLoopActive = activeStep === 2;
  const isCurrentActive = activeStep === 3;

  return (
    <div className="panel-card diagram-panel">
      <div className="panel-header diagram-panel-header">
        <h2 className="panel-title">Circuit Schematic</h2>
        <div className="diagram-status-row">
          <span className={`status-item ${isSourceActive ? 'item-active text-voltage' : ''}`}>
            V = {formatted.voltage}
          </span>
          <span className="status-divider">•</span>
          <span className={`status-item ${isResistorActive ? 'item-active text-resistance' : ''}`}>
            R = {formatted.resistance}
          </span>
          <span className="status-divider">•</span>
          <span className={`status-item ${isCurrentActive ? 'item-active text-current' : ''}`}>
            I = {isValid ? formatted.current : '—'}
          </span>
        </div>
      </div>

      <div className="diagram-viewport">
        <svg
          viewBox="0 0 540 360"
          className="schematic-svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Schematic diagram of an ideal DC voltage source in series with a resistor"
        >
          <defs>
            {/* Subtle Grid Pattern */}
            <pattern id="eng-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a2333" strokeWidth="0.8" />
            </pattern>

            {/* Standard Conductor Current Arrow Marker */}
            <marker
              id="arrow-neutral"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#475569" />
            </marker>

            {/* Active Current Arrow Marker */}
            <marker
              id="arrow-active"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>
          </defs>

          {/* Blueprint Engineering Canvas */}
          <rect width="540" height="360" rx="6" fill="#0c111a" />
          <rect width="540" height="360" rx="6" fill="url(#eng-grid)" />

          {/* BASE CONDUCTOR LOOP (Left 120, Right 420, Top 70, Bottom 290) */}
          <g
            className={`conductor-loop ${isLoopActive ? 'loop-highlighted' : ''}`}
            onClick={() => onSelectStep(2)}
            style={{ cursor: 'pointer' }}
          >
            {/* Top Wire */}
            <line x1="120" y1="70" x2="420" y2="70" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            {/* Bottom Wire */}
            <line x1="120" y1="290" x2="420" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            {/* Left Upper Wire */}
            <line x1="120" y1="70" x2="120" y2="140" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            {/* Left Lower Wire */}
            <line x1="120" y1="220" x2="120" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            {/* Right Upper Wire */}
            <line x1="420" y1="70" x2="420" y2="130" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            {/* Right Lower Wire */}
            <line x1="420" y1="230" x2="420" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
          </g>

          {/* ANIMATED CURRENT FLOW (Subtle dashed path when current flows) */}
          {isCurrentFlowing && (
            <path
              d="M 120 140 L 120 70 L 420 70 L 420 130 M 420 230 L 420 290 L 120 290 L 120 220"
              fill="none"
              stroke={isCurrentActive ? '#10b981' : '#38bdf8'}
              strokeWidth="2"
              strokeDasharray="6 6"
              className="current-dash-flow"
              opacity="0.8"
            />
          )}

          {/* 1. VOLTAGE SOURCE COMPONENT (Left Branch) */}
          <g
            id="comp-source"
            className={`interactive-component ${isSourceActive ? 'comp-focused' : ''}`}
            onClick={() => onSelectStep(0)}
            style={{ cursor: 'pointer' }}
            tabIndex={0}
            role="button"
            aria-label={`Voltage Source: ${formatted.voltage}. Select Step 1.`}
          >
            {/* Component bounding indicator when active */}
            {isSourceActive && (
              <rect
                x="68"
                y="132"
                width="104"
                height="96"
                rx="6"
                fill="rgba(56, 189, 248, 0.05)"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            )}

            {/* Battery Plates */}
            {/* Positive Plate 1 */}
            <line
              x1="95"
              y1="160"
              x2="145"
              y2="160"
              stroke={isSourceActive ? '#38bdf8' : '#cbd5e1'}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* Negative Plate 1 */}
            <line
              x1="106"
              y1="180"
              x2="134"
              y2="180"
              stroke={isSourceActive ? '#38bdf8' : '#64748b'}
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Positive Plate 2 */}
            <line
              x1="95"
              y1="195"
              x2="145"
              y2="195"
              stroke={isSourceActive ? '#38bdf8' : '#cbd5e1'}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
            {/* Negative Plate 2 */}
            <line
              x1="106"
              y1="215"
              x2="134"
              y2="215"
              stroke={isSourceActive ? '#38bdf8' : '#64748b'}
              strokeWidth="5"
              strokeLinecap="round"
            />

            {/* Internal connect lines */}
            <line x1="120" y1="140" x2="120" y2="160" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2.5" />
            <line x1="120" y1="180" x2="120" y2="195" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2" />
            <line x1="120" y1="215" x2="120" y2="225" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2.5" />

            {/* Polarity Symbols */}
            <text x="120" y="152" fill="#38bdf8" fontSize="13" fontWeight="700" textAnchor="middle">+</text>
            <text x="120" y="234" fill="#94a3b8" fontSize="14" fontWeight="700" textAnchor="middle">−</text>

            {/* Label Card */}
            <g transform="translate(18, 166)">
              <rect
                x="0"
                y="0"
                width="64"
                height="32"
                rx="4"
                fill="#111827"
                stroke={isSourceActive ? '#38bdf8' : '#2d3748'}
                strokeWidth="1.2"
              />
              <text x="32" y="14" fill="#64748b" fontSize="9" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">SOURCE</text>
              <text x="32" y="26" fill={isSourceActive ? '#38bdf8' : '#e2e8f0'} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">
                {formatted.voltage}
              </text>
            </g>
          </g>

          {/* 2. RESISTOR COMPONENT (Right Branch) */}
          <g
            id="comp-resistor"
            className={`interactive-component ${isResistorActive ? 'comp-focused' : ''}`}
            onClick={() => onSelectStep(1)}
            style={{ cursor: 'pointer' }}
            tabIndex={0}
            role="button"
            aria-label={`Resistor: ${formatted.resistance}. Select Step 2.`}
          >
            {/* Component bounding indicator when active */}
            {isResistorActive && (
              <rect
                x="372"
                y="118"
                width="96"
                height="124"
                rx="6"
                fill="rgba(245, 158, 11, 0.05)"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            )}

            {/* Zigzag Resistor Profile */}
            <polyline
              points="
                420,130
                436,142
                404,158
                436,174
                404,190
                436,206
                404,222
                420,230
              "
              fill="none"
              stroke={isResistorActive ? '#f59e0b' : '#d97706'}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Label Card */}
            <g transform="translate(458, 166)">
              <rect
                x="0"
                y="0"
                width="64"
                height="32"
                rx="4"
                fill="#111827"
                stroke={isResistorActive ? '#f59e0b' : '#2d3748'}
                strokeWidth="1.2"
              />
              <text x="32" y="14" fill="#64748b" fontSize="9" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">LOAD (R)</text>
              <text x="32" y="26" fill={isResistorActive ? '#f59e0b' : '#e2e8f0'} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">
                {formatted.resistance}
              </text>
            </g>
          </g>

          {/* 3. CURRENT FLOW INDICATORS & ARROWS (Step 4 Highlight) */}
          <g
            id="comp-current"
            className={`interactive-component ${isCurrentActive ? 'comp-focused' : ''}`}
            onClick={() => onSelectStep(3)}
            style={{ cursor: 'pointer' }}
          >
            {/* Top Wire Arrow (Left to Right) */}
            <line
              x1="240"
              y1="70"
              x2="285"
              y2="70"
              stroke={isCurrentActive ? '#10b981' : '#475569'}
              strokeWidth="2.5"
              markerEnd={isCurrentActive ? 'url(#arrow-active)' : 'url(#arrow-neutral)'}
            />

            {/* Bottom Wire Arrow (Right to Left) */}
            <line
              x1="285"
              y1="290"
              x2="240"
              y2="290"
              stroke={isCurrentActive ? '#10b981' : '#475569'}
              strokeWidth="2.5"
              markerEnd={isCurrentActive ? 'url(#arrow-active)' : 'url(#arrow-neutral)'}
            />

            {/* Current Readout Badge */}
            <g transform="translate(230, 26)">
              <rect
                x="0"
                y="0"
                width="82"
                height="28"
                rx="4"
                fill="#111827"
                stroke={isCurrentActive ? '#10b981' : '#2d3748'}
                strokeWidth={isCurrentActive ? '1.5' : '1'}
              />
              <text x="41" y="12" fill="#64748b" fontSize="8.5" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">
                CONVENTIONAL I →
              </text>
              <text
                x="41"
                y="23"
                fill={isCurrentActive ? '#10b981' : '#cbd5e1'}
                fontSize="11"
                fontWeight="700"
                textAnchor="middle"
                fontFamily="var(--font-mono)"
              >
                {isValid ? formatted.current : '—'}
              </text>
            </g>
          </g>

          {/* 4. OHM'S LAW EQUATION CALLOUT (Step 3 Highlight) */}
          <g
            id="comp-formula"
            className={`interactive-component ${isLoopActive ? 'comp-focused' : ''}`}
            onClick={() => onSelectStep(2)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x="200"
              y="160"
              width="140"
              height="44"
              rx="4"
              fill="#111827"
              stroke={isLoopActive ? '#818cf8' : '#242f44'}
              strokeWidth={isLoopActive ? '1.5' : '1'}
            />
            <text x="270" y="177" fill={isLoopActive ? '#818cf8' : '#64748b'} fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">
              Ohm's Law: Closed Loop
            </text>
            <text x="270" y="194" fill="#f1f5f9" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">
              I = V / R
            </text>
          </g>

          {/* Node Connection Points */}
          <circle cx="120" cy="70" r="3.5" fill="#475569" />
          <circle cx="420" cy="70" r="3.5" fill="#475569" />
          <circle cx="420" cy="290" r="3.5" fill="#475569" />
          <circle cx="120" cy="290" r="3.5" fill="#475569" />
        </svg>
      </div>

      <div className="diagram-caption-bar">
        <span>Click any component in the schematic to jump directly to its explanation step.</span>
      </div>
    </div>
  );
}
