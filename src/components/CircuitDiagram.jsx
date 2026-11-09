import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { layoutCircuit, applyEditToComponent, rerouteLayout } from '../circuit/circuitLayout.js';

/**
 * Technical SVG Schematic of a DC Series Circuit
 *
 * Two rendering modes:
 *  1. "demo"   — the original hardcoded single-source / single-resistor
 *                schematic used by the interactive Ohm's-law workspace.
 *  2. "reconstructed" — renders the circuit detected from an uploaded image,
 *                preserving component identities, values, and electrical
 *                connectivity (nodes, branches, source polarity).
 *
 * The reconstructed mode is activated automatically when an `analysisResult`
 * with detected components is supplied via props.
 */
export default function CircuitDiagram({
  circuitResult,
  activeStep,
  onSelectStep,
  analysisResult,
}) {
  // -----------------------------------------------------------------------
  // Reconstructed mode — render from image analysis
  // -----------------------------------------------------------------------
  const layout = useMemo(() => {
    if (!analysisResult || !analysisResult.components?.length) return null;
    return layoutCircuit(analysisResult);
  }, [analysisResult]);

  if (analysisResult && analysisResult.components?.length > 0) {
    return <ReconstructedDiagram layout={layout} analysisResult={analysisResult} />;
  }

  // -----------------------------------------------------------------------
  // Demo mode — original hardcoded series circuit
  // -----------------------------------------------------------------------
  return <DemoDiagram circuitResult={circuitResult} activeStep={activeStep} onSelectStep={onSelectStep} />;
}

/* ======================================================================= *
 * RECONSTRUCTED DIAGRAM
 * ======================================================================= */

const TYPE_COLORS = {
  resistor: '#f59e0b',
  battery: '#38bdf8',
  voltage_source: '#38bdf8',
  ac_voltage_source: '#22d3ee',
  current_source: '#a78bfa',
  capacitor: '#34d399',
  inductor: '#fb7185',
  diode: '#60a5fa',
  led: '#f87171',
  switch: '#94a3b8',
  ground: '#64748b',
  ammeter: '#818cf8',
  voltmeter: '#c084fc',
  wire: '#475569',
  unknown: '#9ca3af',
};

/**
 * Draws a single component between its two terminal node positions.
 * The symbol is rendered in local coordinates (centered at origin, along
 * the +x axis) and transformed to the correct screen position + rotation.
 */
function ComponentSymbol({ comp, selected }) {
  const { x1, y1, x2, y2, type, value, id, posTerminal, status, labelPosition } = comp;
  const aIsPos = posTerminal === 'A';
  const bIsPos = posTerminal === 'B';
  const mx = comp.center?.x ?? Math.round((x1 + x2) / 2);
  const my = comp.center?.y ?? Math.round((y1 + y2) / 2);

  const color = TYPE_COLORS[type] ?? TYPE_COLORS.unknown;

  // All geometry comes from the layout engine: rotation, symbol extent and the
  // terminal points. The renderer never re-derives them, so the drawn symbol,
  // its leads, and the wire endpoints cannot disagree.
  const angle = comp.angle ?? (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  const symbolHalf = comp.symbolHalf ?? 26;

  // Leads run along the terminal vector (terminal 0 → terminal 1), which is the
  // axis the layout built the symbol on. Each lead ends exactly on its terminal,
  // so there is never a gap between the symbol body and the connecting wire.
  const span = Math.hypot(x2 - x1, y2 - y1) || 1;
  const tx = (x2 - x1) / span;
  const ty = (y2 - y1) / span;
  const sx1 = mx - tx * symbolHalf;
  const sy1 = my - ty * symbolHalf;
  const sx2 = mx + tx * symbolHalf;
  const sy2 = my + ty * symbolHalf;

  const perpX = -ty;
  const perpY = tx;
  // Use collision-free computed label coordinates when available
  const labelX = labelPosition?.x ?? Math.round(mx + perpX * 36);
  const labelY = labelPosition?.y ?? Math.round(my + perpY * 36);

  // Uncertainty border color
  const borderColor = status === 'uncertain' ? '#ef4444' : status === 'probable' ? '#f59e0b' : '#2d3748';

  // Selection highlight box (symbolBox)
  const selBox = selected && comp.symbolBox ? comp.symbolBox : null;

  return (
    <g className="rc-comp" data-comp-id={id} style={{ cursor: 'move' }}>
      {/* Invisible hit area — covers the full draw box (symbol + leads) so the
          user doesn't need to click precisely on a thin line. */}
      {comp.drawBox && (
        <rect
          x={comp.drawBox.minX}
          y={comp.drawBox.minY}
          width={comp.drawBox.maxX - comp.drawBox.minX}
          height={comp.drawBox.maxY - comp.drawBox.minY}
          fill="transparent"
          stroke="none"
        />
      )}

      {/* Selection highlight — brighter and thicker for clear visibility */}
      {selBox && (
        <rect
          x={selBox.minX - 6}
          y={selBox.minY - 6}
          width={selBox.maxX - selBox.minX + 12}
          height={selBox.maxY - selBox.minY + 12}
          rx="6"
          fill="rgba(56, 189, 248, 0.06)"
          stroke="#38bdf8"
          strokeWidth="2"
          strokeDasharray="5 3"
          opacity="0.9"
        />
      )}

      {/* leader wires — connect component symbol boundary cleanly to terminals with zero gap */}
      {type !== 'wire' && (
        <>
          <line x1={x1} y1={y1} x2={sx1} y2={sy1} stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
          <line x1={sx2} y1={sy2} x2={x2} y2={y2} stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
        </>
      )}

      {/* symbol */}
      <g transform={`translate(${mx} ${my}) rotate(${angle})`}>
        {renderSymbol(type, color, aIsPos, bIsPos)}
      </g>

      {/* collision-free label card */}
      <g transform={`translate(${labelX} ${labelY})`}>
        <rect x="-27" y="-15" width="54" height="30" rx="4" fill="#111827" stroke={borderColor} strokeWidth={status === 'uncertain' || status === 'probable' ? 1.5 : 1} />
        <text x="0" y="-3" fill="#64748b" fontSize="8" fontWeight="600" textAnchor="middle" fontFamily="var(--font-mono)">
          {id}{status === 'uncertain' ? ' ?' : status === 'probable' ? ' ~' : ''}
        </text>
        <text x="0" y="9" fill={color} fontSize="10" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">
          {value || (type !== 'unknown' ? '—' : '?')}
        </text>
      </g>
    </g>
  );
}

/** Returns SVG for a component symbol in local coordinates (origin-centered, along +x). */
function renderSymbol(type, color, aIsPos, bIsPos) {
  switch (type) {
    case 'resistor':
      return (
        <polyline
          points="-26,0 -20,-9 -12,9 -4,-9 4,9 12,-9 20,9 26,0"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );

    case 'battery':
    case 'voltage_source':
      return (
        <g stroke={color} strokeLinecap="round">
          {/* + plate (long) */}
          <line x1={-10} y1="-14" x2={-10} y2="14" strokeWidth="3.5" />
          {/* - plate (short) */}
          <line x1={10} y1="-9" x2={10} y2="9" strokeWidth="5" />
          {/* second cell */}
          <line x1={2} y1="-14" x2={2} y2="14" strokeWidth="3.5" />
          <line x1={-2} y1="-9" x2={-2} y2="9" strokeWidth="5" />
          {/* polarity labels */}
          <text x={-14} y="-18" fill="#38bdf8" fontSize="11" fontWeight="700" textAnchor="middle">+</text>
          <text x={14} y="-18" fill="#94a3b8" fontSize="12" fontWeight="700" textAnchor="middle">−</text>
        </g>
      );

    case 'current_source':
      return (
        <g>
          <circle cx="0" cy="0" r="18" fill="none" stroke={color} strokeWidth="2.5" />
          <path d="M -8 0 L 8 0 M 4 -4 L 8 0 L 4 4" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );

    case 'ac_voltage_source':
      return (
        <g>
          <circle cx="0" cy="0" r="18" fill="none" stroke={color} strokeWidth="2.5" />
          <path d="M -9 0 Q -4.5 -7 0 0 Q 4.5 7 9 0" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </g>
      );

    case 'ammeter':
      return (
        <g>
          <circle cx="0" cy="0" r="18" fill="none" stroke={color} strokeWidth="2.5" />
          <text x="0" y="5" fill={color} fontSize="13" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">A</text>
        </g>
      );

    case 'voltmeter':
      return (
        <g>
          <circle cx="0" cy="0" r="18" fill="none" stroke={color} strokeWidth="2.5" />
          <text x="0" y="5" fill={color} fontSize="13" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">V</text>
        </g>
      );

    case 'capacitor':
      return (
        <g stroke={color} strokeWidth="3" strokeLinecap="round">
          <line x1="-5" y1="-14" x2="-5" y2="14" />
          <line x1="5" y1="-14" x2="5" y2="14" />
        </g>
      );

    case 'inductor':
      return (
        <path
          d="M -26 0 A 6.5 6.5 0 0 1 -13 0 A 6.5 6.5 0 0 1 0 0 A 6.5 6.5 0 0 1 13 0 A 6.5 6.5 0 0 1 26 0"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );

    case 'diode':
      return (
        <g>
          <polygon points="-12,-12 -12,12 12,0" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="12" y1="-12" x2="12" y2="12" stroke={color} strokeWidth="3" strokeLinecap="round" />
        </g>
      );

    case 'led':
      return (
        <g>
          <polygon points="-12,-12 -12,12 12,0" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="12" y1="-12" x2="12" y2="12" stroke={color} strokeWidth="3" strokeLinecap="round" />
          {/* emission arrows */}
          <g stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round">
            <line x1="10" y1="-14" x2="20" y2="-22" />
            <polyline points="14,-22 20,-22 20,-16" />
            <line x1="16" y1="-6" x2="26" y2="-14" />
            <polyline points="20,-14 26,-14 26,-8" />
          </g>
        </g>
      );

    case 'switch':
      return (
        <g stroke={color} strokeWidth="2.5" strokeLinecap="round" fill="none">
          <circle cx="-22" cy="0" r="2.5" fill={color} />
          <circle cx="22" cy="0" r="2.5" fill={color} />
          <line x1="-22" y1="0" x2="14" y2="-12" />
        </g>
      );

    case 'ground':
      return (
        <g stroke={color} strokeWidth="2.5" strokeLinecap="round">
          <line x1="0" y1="-14" x2="0" y2="0" />
          <line x1="-14" y1="0" x2="14" y2="0" />
          <line x1="-9" y1="6" x2="9" y2="6" />
          <line x1="-4" y1="12" x2="4" y2="12" />
        </g>
      );

    case 'wire':
      // Wire components are drawn as plain conductors (no symbol).
      return null;

    case 'unknown':
    default:
      return (
        <g>
          <rect x="-14" y="-12" width="28" height="24" rx="3" fill="none" stroke={color} strokeWidth="2.5" />
          <text x="0" y="6" fill={color} fontSize="16" fontWeight="700" textAnchor="middle">?</text>
        </g>
      );
  }
}

// Grid snap interval (SVG user-space pixels). Makes dragging feel aligned.
const SNAP = 10;
function snap(v) { return Math.round(v / SNAP) * SNAP; }

function ReconstructedDiagram({ layout, analysisResult }) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [selectedId, setSelectedId] = useState(null);     // component ID
  const [selectedNode, setSelectedNode] = useState(null); // node ID
  const [selectedWire, setSelectedWire] = useState(null); // wire ID
  const [edits, setEdits] = useState(() => new Map());     // compId → {center?, axis?}
  const [nodeEdits, setNodeEdits] = useState(() => new Map()); // nodeId → {x, y}
  const dragRef = useRef({ mode: 'none', x: 0, y: 0, ox: 0, oy: 0, compId: null, nodeId: null, startCenter: null, startNode: null });
  const svgRef = useRef(null);
  const viewportRef = useRef(null);

  // --- Apply visual edits (component move/rotate + node move) and re-route wires ---
  const editedLayout = useMemo(() => {
    if (!layout || !layout.ok) return layout;
    if (edits.size === 0 && nodeEdits.size === 0) return layout;
    const components = layout.components.map((c) => {
      const edit = edits.get(c.id);
      return edit ? applyEditToComponent(c, edit) : c;
    });
    return rerouteLayout({ ...layout, components }, nodeEdits.size > 0 ? nodeEdits : null);
  }, [layout, edits, nodeEdits]);

  // --- Zoom controls (button-only; wheel zoom was removed) -------------
  const onZoom = useCallback((factor) => {
    setView((v) => ({ ...v, k: Math.min(8, Math.max(0.5, v.k * factor)) }));
  }, []);

  const onResetView = useCallback(() => {
    setView({ x: 0, y: 0, k: 1 });
  }, []);

  // --- Component rotation (only when a component, not a node, is selected) ---
  const onRotate = useCallback(() => {
    if (!selectedId) return;
    const comp = editedLayout?.components?.find((c) => c.id === selectedId);
    if (!comp) return;
    const newAxis = { x: -comp.axis.y, y: comp.axis.x }; // 90° clockwise
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(selectedId, { ...(next.get(selectedId) || {}), axis: newAxis });
      return next;
    });
  }, [selectedId, editedLayout]);

  // --- Convert a client point to SVG user-space coordinates -------------
  const clientToSvg = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  }, []);

  // --- Pointer handlers: node drag, component drag, wire select, OR pan ---
  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;

    // The lead hitbox and crossing markers are painted above the wire polylines.
    // closest(e.target) only sees the top element, so look through those two
    // overlays. A junction circle or a real component graphic still wins.
    const svg = svgRef.current;
    const raw = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(e.clientX, e.clientY)
      : [e.target];
    const inside = raw.filter((el) => el && (!svg || svg.contains(el)));
    const hits = inside.length > 0 ? inside : [e.target];

    const isLeadHitbox = (el) => {
      if (!el || el.localName !== 'rect') return false;
      if (el.getAttribute?.('fill') !== 'transparent') return false;
      const stroke = el.getAttribute?.('stroke');
      if (stroke && stroke !== 'none') return false;
      return Boolean(el.closest?.('[data-comp-id]'));
    };

    let nodeEl = null;
    let wireEl = null;
    let compEl = null;
    let leadCompEl = null;

    for (const el of hits) {
      const node = el.closest?.('[data-node-id]');
      if (node) {
        nodeEl = node;
        break;
      }
      if (el.closest?.('.rc-crossing')) continue;
      if (isLeadHitbox(el)) {
        if (!leadCompEl) leadCompEl = el.closest?.('[data-comp-id]') ?? null;
        continue;
      }
      const wire = el.closest?.('[data-wire-id]');
      if (wire) {
        wireEl = wire;
        break;
      }
      const comp = el.closest?.('[data-comp-id]');
      if (comp) {
        // Symbol, label, or leader line. If a lead box already covered this
        // point, that higher component keeps the click.
        if (!leadCompEl) compEl = comp;
        break;
      }
      break;
    }

    // 1. Junction hit circle. Clear any wire selection, then drag when the
    //    id matches a layout node. An unmatched id falls through to pan, as before.
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id');
      setSelectedNode(nodeId);
      setSelectedId(null);
      setSelectedWire(null);
      const node = editedLayout?.nodes?.find((n) => n.id === nodeId);
      if (node) {
        dragRef.current = {
          mode: 'node',
          nodeId,
          startClient: { x: e.clientX, y: e.clientY },
          startNode: { x: node.x, y: node.y },
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
    } else if (wireEl) {
      // 2. Wire, including one lying under a lead hitbox or crossing marker.
      const wireId = wireEl.getAttribute('data-wire-id');
      setSelectedWire(wireId);
      setSelectedId(null);
      setSelectedNode(null);
      return;
    } else {
      // 3. Component symbol, or the lead box where no wire is underneath.
      const componentHit = compEl || leadCompEl;
      if (componentHit) {
        const compId = componentHit.getAttribute('data-comp-id');
        setSelectedId(compId);
        setSelectedNode(null);
        setSelectedWire(null);
        const comp = editedLayout?.components?.find((c) => c.id === compId);
        if (comp) {
          dragRef.current = {
            mode: 'component',
            compId,
            startClient: { x: e.clientX, y: e.clientY },
            startCenter: { ...comp.center },
          };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          return;
        }
      }
    }

    // 4. Click on empty SVG: deselect everything and start panning
    setSelectedId(null);
    setSelectedNode(null);
    setSelectedWire(null);
    dragRef.current = { mode: 'pan', x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [view.x, view.y, editedLayout]);

  const onPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (drag.mode === 'none') return;
    if (drag.mode === 'pan') {
      const dx = (e.clientX - drag.x) / view.k;
      const dy = (e.clientY - drag.y) / view.k;
      setView((v) => ({ ...v, x: drag.ox - dx, y: drag.oy - dy }));
    } else if (drag.mode === 'component') {
      const cur = clientToSvg(e.clientX, e.clientY);
      const start = clientToSvg(drag.startClient.x, drag.startClient.y);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      setEdits((prev) => {
        const next = new Map(prev);
        next.set(drag.compId, {
          ...(next.get(drag.compId) || {}),
          center: { x: snap(drag.startCenter.x + dx), y: snap(drag.startCenter.y + dy) },
        });
        return next;
      });
    } else if (drag.mode === 'node') {
      const cur = clientToSvg(e.clientX, e.clientY);
      const start = clientToSvg(drag.startClient.x, drag.startClient.y);
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      setNodeEdits((prev) => {
        const next = new Map(prev);
        next.set(drag.nodeId, { x: snap(drag.startNode.x + dx), y: snap(drag.startNode.y + dy) });
        return next;
      });
    }
  }, [view.k, clientToSvg]);

  const onPointerUp = useCallback(() => {
    dragRef.current = { mode: 'none' };
  }, []);

  // Clear all visual edits when a new circuit is loaded
  useEffect(() => {
    setEdits(new Map());
    setNodeEdits(new Map());
    setSelectedId(null);
    setSelectedNode(null);
    setSelectedWire(null);
  }, [layout]);

  if (!layout || !layout.ok) {
    return (
      <div className="panel-card diagram-panel">
        <div className="panel-header diagram-panel-header">
          <h2 className="panel-title">Reconstructed Circuit</h2>
        </div>
        <div className="diagram-viewport">
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
            {layout?.message || 'No circuit could be reconstructed from the image.'}
          </div>
        </div>
      </div>
    );
  }

  const { nodes, components, wires, allWires, junctions, crossings, uncertain, bounds, isApproximation, incomplete, validation, hasGeometry, renderValidation } = editedLayout;
  const displayWires = allWires || wires || [];
  const vbW = bounds.width / view.k;
  const vbH = bounds.height / view.k;
  const viewBox = `${view.x} ${view.y} ${vbW} ${vbH}`;
  const noticeText = incomplete
    ? (layout.message || 'Reconstruction incomplete — some connections are uncertain or missing. See notes below.')
    : (isApproximation
      ? 'Approximate layout — original image geometry was not available. The arrangement may not match the uploaded circuit.'
      : null);

  return (
    <div className="panel-card diagram-panel">
      <div className="panel-header diagram-panel-header">
        <h2 className="panel-title">Reconstructed Circuit</h2>
        <span className="diagram-caption-hint">
          {components.length} components · {nodes.length} nodes{displayWires.length > 0 ? ` · ${displayWires.length} wires` : ''}
        </span>
        <div className="rc-zoom-bar" role="group" aria-label="Diagram zoom">
          {selectedId && (
            <button type="button" className="rc-zoom-btn rc-rotate-btn" onClick={onRotate} aria-label="Rotate selected component 90 degrees" title="Rotate 90°">⟳</button>
          )}
          <button type="button" className="rc-zoom-btn" onClick={() => onZoom(1 / 1.2)} aria-label="Zoom out">−</button>
          <button type="button" className="rc-zoom-btn" onClick={onResetView} aria-label="Reset view">{Math.round(view.k * 100)}%</button>
          <button type="button" className="rc-zoom-btn" onClick={() => onZoom(1.2)} aria-label="Zoom in">+</button>
        </div>
      </div>

      {/* Approximation / incomplete notice — incomplete always wins over a success/approx banner */}
      {noticeText && (
        <div className={`rc-notice ${incomplete ? 'rc-notice--incomplete' : 'rc-notice--approx'}`}>
          ⚠ {noticeText}
        </div>
      )}

      {/* Render validation notice if any connection issues detected */}
      {renderValidation && !renderValidation.isValid && (
        <div className="rc-notice rc-notice--incomplete">
          ⚠ {renderValidation.errors.join('; ')}
        </div>
      )}

      <div
        className="diagram-viewport diagram-viewport--reconstructed"
        ref={viewportRef}
      >
        <svg
          ref={svgRef}
          viewBox={viewBox}
          className="schematic-svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Reconstructed circuit schematic from image analysis"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ cursor: dragRef.current.mode === 'pan' ? 'grabbing' : (dragRef.current.mode === 'component' || dragRef.current.mode === 'node') ? 'move' : 'grab', touchAction: 'none' }}
        >
          <defs>
            <pattern id="rc-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a2333" strokeWidth="0.8" />
            </pattern>
          </defs>

          <rect width={bounds.width} height={bounds.height} rx="6" fill="#0c111a" />
          <rect width={bounds.width} height={bounds.height} rx="6" fill="url(#rc-grid)" />

          {/* Wire paths — both extracted polylines and routed connection wires.
              Each wire has a wide invisible hit polyline for easy clicking
              and a visible polyline on top with pointerEvents disabled. */}
          {displayWires.filter((w) => w.points && w.points.length >= 2).map((w) => {
            const isSel = selectedWire === w.id;
            return (
              <g key={`wire-${w.id}`} data-wire-id={w.id} style={{ cursor: 'pointer' }}>
                {/* Invisible hit area — 16px wide stroke makes thin wires easy to grab */}
                <polyline
                  points={w.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="16"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* Visible wire — highlighted when selected */}
                <polyline
                  points={w.points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={isSel ? '#38bdf8' : (w.isCrossing || (w.confidence != null && w.confidence < 0.6) ? '#94a3b8' : '#475569')}
                  strokeWidth={isSel ? 4 : 2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={w.isCrossing || (w.confidence != null && w.confidence < 0.7) ? '5 4' : undefined}
                  opacity={isSel ? 1 : (w.confidence < 0.6 ? 0.5 : 0.9)}
                  pointerEvents="none"
                />
              </g>
            );
          })}

          {/* Wire-type components as plain conductors */}
          {components.filter((c) => c.type === 'wire').map((c) => (
            <line key={`wcomp-${c.id}`} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="#475569" strokeWidth="2.5" />
          ))}

          {/* Crossing markers (semicircular bridge jump for unconnected crossings) */}
          {crossings.map((cx, i) => {
            let pt = cx.point;
            if (!pt) {
              const wire = displayWires.find((w) => w.id === cx.wireId);
              if (wire && wire.points && wire.points.length >= 2) {
                const midIdx = Math.floor(wire.points.length / 2);
                pt = wire.points[midIdx];
              }
            }
            if (!pt) return null;
            return (
              <g key={cx.id || `cross-${i}`} className="rc-crossing">
                <circle cx={pt.x} cy={pt.y} r="6" fill="#0c111a" stroke="#94a3b8" strokeWidth="1.2" />
                <path d={`M ${pt.x - 5} ${pt.y} A 5 5 0 0 1 ${pt.x + 5} ${pt.y}`} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" />
              </g>
            );
          })}

          {/* Non-wire components */}
          {components.filter((c) => c.type !== 'wire').map((c) => (
            <ComponentSymbol key={c.id} comp={c} selected={c.id === selectedId} />
          ))}

          {/* Junction dots — one per 3+-member electrical node, drawn exactly at
              the rail anchor where its member wires meet. Each junction has a
              large invisible hit circle for easy grabbing. */}
          {junctions.filter((j) => j.isJunction !== false).map((j) => (
            <g key={`jct-${j.id}`} data-node-id={j.id} style={{ cursor: 'move' }}>
              {/* Invisible hit area — much larger than the visible dot */}
              <circle cx={j.x} cy={j.y} r="16" fill="transparent" stroke="none" />
              {/* Selection ring */}
              {selectedNode === j.id && (
                <circle cx={j.x} cy={j.y} r="11" fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
              )}
              {/* Visible junction dot */}
              <circle cx={j.x} cy={j.y} r="5" fill={selectedNode === j.id ? '#38bdf8' : '#818cf8'} stroke="#0c111a" strokeWidth="1.5" />
            </g>
          ))}

          {/* Node labels */}
          {nodes.map((n) => (
            <text key={`nl-${n.id}`} x={n.x + 8} y={n.y - 8} fill="#475569" fontSize="9" fontFamily="var(--font-mono)">
              {n.id}
            </text>
          ))}
        </svg>
      </div>

      {/* Uncertainty notes */}
      {uncertain.length > 0 && (
        <div className="rc-uncertain-notes">
          {uncertain.map((u, i) => (
            <div key={i} className="rc-uncertain-item">
              ⚠ {u.from} ↔ {u.to}: {u.notes}
            </div>
          ))}
        </div>
      )}

      {/* Validation warnings */}
      {validation?.warnings?.length > 0 && (
        <div className="rc-validation-warnings">
          {validation.warnings.map((w, i) => (
            <div key={i} className="rc-validation-item">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ======================================================================= *
 * DEMO DIAGRAM (original hardcoded series circuit)
 * ======================================================================= */
function DemoDiagram({
  circuitResult,
  activeStep,
  onSelectStep,
}) {
  const { formatted, isValid, current } = circuitResult;
  const isCurrentFlowing = isValid && current !== null && current !== 0;

  const isSourceActive = activeStep === 0;
  const isResistorActive = activeStep === 1 || activeStep === 3;
  const isCurrentActive = activeStep === 2;
  const isLoopActive = activeStep === 2;
  const isPowerActive = activeStep === 3;

  return (
    <div className="panel-card diagram-panel">
      <div className="panel-header diagram-panel-header">
        <h2 className="panel-title">Circuit Schematic</h2>
        <span className="diagram-caption-hint">Click any component to focus step</span>
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
            <pattern id="eng-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1a2333" strokeWidth="0.8" />
            </pattern>
            <marker id="arrow-neutral" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#475569" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="#10b981" />
            </marker>
          </defs>

          <rect width="540" height="360" rx="6" fill="#0c111a" />
          <rect width="540" height="360" rx="6" fill="url(#eng-grid)" />

          <g className={`conductor-loop ${isLoopActive ? 'loop-highlighted' : ''}`} onClick={() => onSelectStep(2)} style={{ cursor: 'pointer' }}>
            <line x1="120" y1="70" x2="420" y2="70" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            <line x1="120" y1="290" x2="420" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            <line x1="120" y1="70" x2="120" y2="140" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            <line x1="120" y1="220" x2="120" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            <line x1="420" y1="70" x2="420" y2="130" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
            <line x1="420" y1="230" x2="420" y2="290" stroke={isLoopActive ? '#818cf8' : '#334155'} strokeWidth="2.5" />
          </g>

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

          <g id="comp-source" className={`interactive-component ${isSourceActive ? 'comp-focused' : ''}`} onClick={() => onSelectStep(0)} style={{ cursor: 'pointer' }} tabIndex={0} role="button" aria-label={`Voltage Source: ${formatted.voltage}. Select Step 1.`}>
            {isSourceActive && <rect x="68" y="132" width="104" height="96" rx="6" fill="rgba(56, 189, 248, 0.05)" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="3 3" />}
            <line x1="95" y1="160" x2="145" y2="160" stroke={isSourceActive ? '#38bdf8' : '#cbd5e1'} strokeWidth="3.5" strokeLinecap="round" />
            <line x1="106" y1="180" x2="134" y2="180" stroke={isSourceActive ? '#38bdf8' : '#64748b'} strokeWidth="5" strokeLinecap="round" />
            <line x1="95" y1="195" x2="145" y2="195" stroke={isSourceActive ? '#38bdf8' : '#cbd5e1'} strokeWidth="3.5" strokeLinecap="round" />
            <line x1="106" y1="215" x2="134" y2="215" stroke={isSourceActive ? '#38bdf8' : '#64748b'} strokeWidth="5" strokeLinecap="round" />
            <line x1="120" y1="140" x2="120" y2="160" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2.5" />
            <line x1="120" y1="180" x2="120" y2="195" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2" />
            <line x1="120" y1="215" x2="120" y2="225" stroke={isSourceActive ? '#38bdf8' : '#475569'} strokeWidth="2.5" />
            <text x="120" y="152" fill="#38bdf8" fontSize="13" fontWeight="700" textAnchor="middle">+</text>
            <text x="120" y="234" fill="#94a3b8" fontSize="14" fontWeight="700" textAnchor="middle">−</text>
            <g transform="translate(18, 166)">
              <rect x="0" y="0" width="64" height="32" rx="4" fill="#111827" stroke={isSourceActive ? '#38bdf8' : '#2d3748'} strokeWidth="1.2" />
              <text x="32" y="14" fill="#64748b" fontSize="9" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">SOURCE</text>
              <text x="32" y="26" fill={isSourceActive ? '#38bdf8' : '#e2e8f0'} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">{formatted.voltage}</text>
            </g>
          </g>

          <g id="comp-resistor" className={`interactive-component ${isResistorActive ? 'comp-focused' : ''}`} onClick={() => onSelectStep(activeStep < 2 ? 1 : (activeStep === 3 ? 1 : 3))} style={{ cursor: 'pointer' }} tabIndex={0} role="button" aria-label={isPowerActive ? `Power dissipation in resistor: ${formatted.power}` : `Resistor: ${formatted.resistance}`}>
            {isResistorActive && <rect x="372" y="118" width="96" height="124" rx="6" fill={isPowerActive ? 'rgba(249, 115, 22, 0.08)' : 'rgba(245, 158, 11, 0.05)'} stroke={isPowerActive ? '#f97316' : '#f59e0b'} strokeWidth="1.5" strokeDasharray="3 3" />}
            <polyline points="420,130 436,142 404,158 436,174 404,190 436,206 404,222 420,230" fill="none" stroke={isPowerActive ? '#f97316' : isResistorActive ? '#f59e0b' : '#d97706'} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            <g transform="translate(458, 166)">
              <rect x="0" y="0" width="64" height="32" rx="4" fill="#111827" stroke={isPowerActive ? '#f97316' : isResistorActive ? '#f59e0b' : '#2d3748'} strokeWidth="1.2" />
              <text x="32" y="14" fill={isPowerActive ? '#f97316' : '#64748b'} fontSize="9" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">{isPowerActive ? 'HEAT (P)' : 'LOAD (R)'}</text>
              <text x="32" y="26" fill={isPowerActive ? '#f97316' : isResistorActive ? '#f59e0b' : '#e2e8f0'} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">{isPowerActive ? (isValid ? formatted.power : '—') : formatted.resistance}</text>
            </g>
          </g>

          <g id="comp-current" className={`interactive-component ${isCurrentActive ? 'comp-focused' : ''}`} onClick={() => onSelectStep(2)} style={{ cursor: 'pointer' }}>
            <line x1="240" y1="70" x2="285" y2="70" stroke={isCurrentActive ? '#10b981' : '#475569'} strokeWidth="2.5" markerEnd={isCurrentActive ? 'url(#arrow-active)' : 'url(#arrow-neutral)'} />
            <line x1="285" y1="290" x2="240" y2="290" stroke={isCurrentActive ? '#10b981' : '#475569'} strokeWidth="2.5" markerEnd={isCurrentActive ? 'url(#arrow-active)' : 'url(#arrow-neutral)'} />
            <g transform="translate(230, 26)">
              <rect x="0" y="0" width="82" height="28" rx="4" fill="#111827" stroke={isCurrentActive ? '#10b981' : '#2d3748'} strokeWidth={isCurrentActive ? '1.5' : '1'} />
              <text x="41" y="12" fill="#64748b" fontSize="8.5" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">CONVENTIONAL I →</text>
              <text x="41" y="23" fill={isCurrentActive ? '#10b981' : '#cbd5e1'} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">{isValid ? formatted.current : '—'}</text>
            </g>
          </g>

          <g id="comp-formula" className={`interactive-component ${isLoopActive ? 'comp-focused' : ''}`} onClick={() => onSelectStep(2)} style={{ cursor: 'pointer' }}>
            <rect x="200" y="160" width="140" height="44" rx="4" fill="#111827" stroke={isLoopActive ? '#818cf8' : '#242f44'} strokeWidth={isLoopActive ? '1.5' : '1'} />
            <text x="270" y="177" fill={isLoopActive ? '#818cf8' : '#64748b'} fontSize="10" fontWeight="600" textAnchor="middle" fontFamily="var(--font-sans)">Ohm's Law: Closed Loop</text>
            <text x="270" y="194" fill="#f1f5f9" fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">I = V / R</text>
          </g>

          <circle cx="120" cy="70" r="3.5" fill="#475569" />
          <circle cx="420" cy="70" r="3.5" fill="#475569" />
          <circle cx="420" cy="290" r="3.5" fill="#475569" />
          <circle cx="120" cy="290" r="3.5" fill="#475569" />
        </svg>
      </div>
    </div>
  );
}
