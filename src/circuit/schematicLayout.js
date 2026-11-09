/**
 * schematicLayout — the single canonical visual-layout pipeline.
 *
 * Responsibilities are deliberately separated from the rest of the app:
 *
 *   electricalGraph.js   → electrical nodes, components, terminal→node mapping
 *   schematicLayout.js   → node anchors, component symbols, wire routes, validation
 *   CircuitDiagram.jsx   → draws exactly what this module returns (no geometry maths)
 *
 * Invariants this module guarantees by construction (and re-checks in
 * validateSchematic before the renderer ever sees the data):
 *
 *   1. Every wire segment is orthogonal (horizontal or vertical).
 *   2. Every wire endpoint is a component terminal or a node anchor — no
 *      floating or dangling geometry is ever emitted.
 *   3. A 2-member electrical node is drawn as ONE wire edge between the two
 *      member terminals (a straight run or a single corner).
 *   4. A 3+-member electrical node is drawn as a rail anchor: every member
 *      terminal gets its own segment to the anchor and a single junction dot.
 *      This is what makes parallel branches, bridges and multi-branch nodes
 *      visually continuous.
 *   5. Components are fixed-size symbols. Any leftover distance to the node is
 *      wire, never a stretched component body — that is what produced the
 *      "components spanning the whole canvas diagonally" defect.
 *   6. Connectivity comes only from the electrical graph. Wire crossings never
 *      merge nodes; crossings are recorded as bridge glyphs.
 *
 * Layout mode
 *   - Geometry mode: the image analysis provides component centres/terminals,
 *     so symbols keep their real position, orientation and length. Only the
 *     WIRES are regenerated from the graph, because traced polylines are
 *     approximate (diagonal, duplicated, sometimes self-referential).
 *   - Topology mode: no usable geometry, so node anchors are placed on a
 *     rectangle/ring embedding and the same routing is used.
 */

import {
  buildGraph,
  findCycle,
  computeNodes,
  normalizeLabel,
} from './electricalGraph.js';

/* ------------------------------------------------------------------ *\
 * Constants
 * ------------------------------------------------------------------ */

const PAD = 72;
const LANE_GAP = 96;      // perpendicular spacing between parallel branches (label room)
const MIN_SPAN = 84;      // shortest drawn component (symbol + visible leads)
const MAX_SPAN = 200;     // longest drawn component
const NODE_MIN_DIST = 170; // minimum distance between two node anchors
const LEAD_GAP = 14;      // visible lead wire that must remain on each side
const EPS = 0.75;
const LABEL_W = 54;
const LABEL_H = 30;

/** Half-length of each symbol in its own local coordinates (must match the SVG). */
const SYMBOL_HALF = {
  resistor: 26,
  inductor: 26,
  capacitor: 5,
  diode: 12,
  led: 12,
  battery: 10,
  voltage_source: 10,
  current_source: 18,
  ac_voltage_source: 18,
  ammeter: 18,
  voltmeter: 18,
  switch: 22,
  ground: 14,
  unknown: 14,
  wire: 0,
};

/** Half-width of each symbol perpendicular to its axis. */
const SYMBOL_PERP = {
  resistor: 10,
  inductor: 9,
  capacitor: 17,
  diode: 13,
  led: 22,
  battery: 17,
  voltage_source: 17,
  current_source: 20,
  ac_voltage_source: 20,
  ammeter: 20,
  voltmeter: 20,
  switch: 13,
  ground: 15,
  unknown: 13,
  wire: 2,
};

/* ------------------------------------------------------------------ *\
 * Small helpers
 * ------------------------------------------------------------------ */

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function centroid(points) {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function roundPoint(p) {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Dominant axis unit vector for a delta. Never diagonal. */
function dominantAxis(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

function symbolHalfOf(type) {
  return SYMBOL_HALF[type] ?? SYMBOL_HALF.unknown;
}

function symbolPerpOf(type) {
  return SYMBOL_PERP[type] ?? SYMBOL_PERP.unknown;
}

function terminalKey(compId, label) {
  return `${compId}.${label}`;
}

/* ------------------------------------------------------------------ *\
 * Canvas
 * ------------------------------------------------------------------ */

function canvasFor(analysis) {
  const iw = Number(analysis?.image_width);
  const ih = Number(analysis?.image_height);
  if (Number.isFinite(iw) && Number.isFinite(ih) && iw > 0 && ih > 0) {
    const width = 640;
    return { width, height: Math.round(clamp((width * ih) / iw, 360, 560)) };
  }
  return { width: 640, height: 430 };
}

function makeProjector(bounds) {
  const w = bounds.width - 2 * PAD;
  const h = bounds.height - 2 * PAD;
  return (p) => (p ? { x: PAD + p.x * w, y: PAD + p.y * h } : null);
}

/* ------------------------------------------------------------------ *\
 * Stage 0 — conservative connection recovery
 *
 * Gemini often reports traced wire paths but omits the matching connection.
 * Recovering a connection from a wire whose BOTH endpoints appear in no other
 * connection is evidence-based, not invention. Ambiguous/uncertain pairs are
 * left alone.
 * ------------------------------------------------------------------ */

function analysisWithInferredConnections(analysis) {
  const components = Array.isArray(analysis?.components) ? analysis.components : [];
  const connections = Array.isArray(analysis?.connections) ? [...analysis.connections] : [];
  const wires = Array.isArray(analysis?.wires) ? analysis.wires : [];
  if (!wires.length) return { ...analysis, connections };

  const ids = new Set(components.filter(Boolean).map((c) => c.id));
  const covered = new Set();
  for (const conn of connections) {
    if (!conn) continue;
    covered.add(terminalKey(conn.from_component, normalizeLabel(conn.from_terminal)));
    covered.add(terminalKey(conn.to_component, normalizeLabel(conn.to_terminal)));
  }

  const inferred = [];
  for (const w of wires) {
    if (!w || !w.from_component || !w.to_component) continue;
    if (!ids.has(w.from_component) || !ids.has(w.to_component)) continue;
    const a = terminalKey(w.from_component, normalizeLabel(w.from_terminal));
    const b = terminalKey(w.to_component, normalizeLabel(w.to_terminal));
    if (a === b) continue;
    if (covered.has(a) || covered.has(b)) continue;
    if (Number(w.confidence ?? 1) < 0.5) continue;
    inferred.push({
      from_component: w.from_component,
      from_terminal: w.from_terminal,
      to_component: w.to_component,
      to_terminal: w.to_terminal,
      confidence: Math.min(Number(w.confidence ?? 0.6), 0.6),
      notes: 'Inferred from a traced wire path — no explicit connection was reported.',
    });
    covered.add(a);
    covered.add(b);
  }

  return { ...analysis, connections: inferred.length ? [...connections, ...inferred] : connections };
}

/* ------------------------------------------------------------------ *\
 * Stage 1 — node anchors
 * ------------------------------------------------------------------ */

function collectNodeMembers(comps, project) {
  const members = new Map();
  for (const c of comps) {
    c.terminals.forEach((t, index) => {
      if (!t.node) return;
      let point = t.position ? project(t.position) : null;
      if (!point && c.center) {
        // Estimate a terminal position from the component centre + orientation
        // so a partially geometric detection still contributes to its node.
        const centre = project(c.center);
        const rad = ((c.orientation ?? 0) * Math.PI) / 180;
        const sign = index === 0 ? -1 : 1;
        point = {
          x: centre.x + Math.cos(rad) * 26 * sign,
          y: centre.y + Math.sin(rad) * 26 * sign,
        };
      }
      if (!members.has(t.node)) members.set(t.node, []);
      members.get(t.node).push({
        compId: c.id,
        label: t.label,
        key: terminalKey(c.id, t.label),
        point,
        estimated: !t.position,
      });
    });
  }
  return members;
}

function nodeOfMap(comps) {
  const map = new Map();
  for (const c of comps) {
    for (const t of c.terminals) {
      if (t.node) map.set(terminalKey(c.id, t.label), t.node);
    }
  }
  return map;
}

function pointsOnPerimeter(n, rect) {
  const { x0, y0, x1, y1 } = rect;
  const width = x1 - x0;
  const height = y1 - y0;
  const perim = 2 * (width + height);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const d = (i / n) * perim;
    let x;
    let y;
    if (d < width) {
      x = x0 + d;
      y = y0;
    } else if (d < width + height) {
      x = x1;
      y = y0 + (d - width);
    } else if (d < 2 * width + height) {
      x = x1 - (d - width - height);
      y = y1;
    } else {
      x = x0;
      y = y1 - (d - 2 * width - height);
    }
    pts.push({ x: Math.round(x), y: Math.round(y) });
  }
  return pts;
}

function pickFreePoint(from, taken, rect) {
  const dirs = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  for (const scale of [160, 240, 320, 420]) {
    for (const dir of dirs) {
      const cand = {
        x: Math.round(clamp(from.x + dir.x * scale, rect.x0, rect.x1)),
        y: Math.round(clamp(from.y + dir.y * scale, rect.y0, rect.y1)),
      };
      if (taken.every((t) => dist(t, cand) >= Math.max(120, Math.min(240, (rect.x1 - rect.x0) / Math.max(taken.length + 1, 3))))) return cand;
    }
  }
  return { x: Math.round((rect.x0 + rect.x1) / 2), y: Math.round((rect.y0 + rect.y1) / 2) };
}

function separateAnchors(plan, bounds) {
  const nodeCount = plan.size || 1;
  const minDist = Math.max(120, Math.min(240, (bounds.width - 2 * PAD) / Math.max(nodeCount, 3)));
  const placed = [];
  for (const info of plan.values()) {
    if (!info.point) continue;
    let p = roundPoint(info.point);
    let guard = 0;
    while (placed.some((q) => dist(q, p) < minDist) && guard < 12) {
      p = {
        x: clamp(p.x + 44, PAD / 2, bounds.width - PAD / 2),
        y: clamp(p.y + (guard % 2 ? -34 : 34), PAD / 2, bounds.height - PAD / 2),
      };
      guard += 1;
    }
    info.point = roundPoint(p);
    placed.push(info.point);
  }
}

function placeNodesTopologically(plan, comps, bounds) {
  const rect = {
    x0: PAD,
    y0: PAD,
    x1: bounds.width - PAD,
    y1: bounds.height - PAD,
  };
  const placed = new Map();

  const cycle = findCycle(comps, nodeOfMap(comps)) || [];
  if (cycle.length >= 2) {
    const pts = pointsOnPerimeter(cycle.length, rect);
    cycle.forEach((id, i) => {
      if (plan.has(id)) placed.set(id, pts[i]);
    });
  }

  const neighbours = new Map();
  for (const c of comps) {
    const [t0, t1] = c.terminals;
    if (!t0?.node || !t1?.node || t0.node === t1.node) continue;
    if (!neighbours.has(t0.node)) neighbours.set(t0.node, new Set());
    if (!neighbours.has(t1.node)) neighbours.set(t1.node, new Set());
    neighbours.get(t0.node).add(t1.node);
    neighbours.get(t1.node).add(t0.node);
  }

  if (placed.size === 0) {
    const first = [...plan.keys()][0];
    if (first) {
      placed.set(first, { x: rect.x0, y: Math.round((rect.y0 + rect.y1) / 2) });
    }
  }

  const queue = [...placed.keys()];
  while (queue.length) {
    const cur = queue.shift();
    const from = placed.get(cur);
    for (const nb of neighbours.get(cur) || []) {
      if (placed.has(nb) || !plan.has(nb)) continue;
      placed.set(nb, pickFreePoint(from, [...placed.values()], rect));
      queue.push(nb);
    }
  }

  for (const id of plan.keys()) {
    if (!placed.has(id)) {
      placed.set(id, { x: Math.round((rect.x0 + rect.x1) / 2), y: Math.round((rect.y0 + rect.y1) / 2) });
    }
  }
  for (const [id, point] of placed) plan.get(id).point = point;
}

function planNodes(graph, comps, bounds, project, useGeometry) {
  const members = collectNodeMembers(comps, project);
  const plan = new Map();

  for (const n of graph.nodes) {
    const list = members.get(n.id) || [];
    const pts = list.filter((m) => m.point).map((m) => m.point);
    plan.set(n.id, {
      id: n.id,
      members: list,
      degree: list.length,
      isRail: list.length >= 3,
      point: pts.length ? centroid(pts) : null,
    });
  }

  const missing = [...plan.values()].some((p) => !p.point);
  if (!useGeometry || missing) {
    for (const info of plan.values()) info.point = null;
    placeNodesTopologically(plan, comps, bounds);
  }

  separateAnchors(plan, bounds);
  return plan;
}

/* ------------------------------------------------------------------ *\
 * Stage 2 — component symbols
 * ------------------------------------------------------------------ */

/** Box occupied by the symbol body only. */
function componentBox(comp) {
  const along = comp.symbolHalf;
  const perp = comp.symbolPerp;
  const halfX = Math.abs(comp.axis.x) * along + Math.abs(comp.axis.y) * perp;
  const halfY = Math.abs(comp.axis.y) * along + Math.abs(comp.axis.x) * perp;
  return {
    minX: comp.center.x - halfX,
    maxX: comp.center.x + halfX,
    minY: comp.center.y - halfY,
    maxY: comp.center.y + halfY,
  };
}

/**
 * Box occupied by the whole drawn component, leads included.
 * Used to keep components apart: two symbols whose leads lie on the same line
 * are just as unreadable as two overlapping symbol bodies.
 */
function componentDrawBox(comp) {
  const perp = Math.max(comp.symbolPerp, 6);
  const halfX = Math.abs(comp.axis.x) * comp.halfSpan + Math.abs(comp.axis.y) * perp;
  const halfY = Math.abs(comp.axis.y) * comp.halfSpan + Math.abs(comp.axis.x) * perp;
  return {
    minX: comp.center.x - halfX,
    maxX: comp.center.x + halfX,
    minY: comp.center.y - halfY,
    maxY: comp.center.y + halfY,
  };
}

/**
 * Rotation (degrees) applied to a component glyph so that its local +x axis
 * points at terminal 1 and its local \u2212x axis (where polarized symbols draw
 * their "+" side) points at terminal 0.
 *
 * Used both when the layout is first built and when an edit re-derives a
 * component, so a move or a rotate can never invert a source's drawn polarity.
 * Terminal identity, posTerminal and node membership are untouched \u2014 only the
 * glyph rotation is recomputed, from the same rule, in both places.
 */
export function symbolAngle(axis, terminals) {
  const base = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
  const t1 = terminals?.[1];
  const t1IsPositive = t1?.polarity === '+' || t1?.label === '+';
  return t1IsPositive ? base + 180 : base;
}

function boxesOverlap(a, b, margin = 0) {
  return (
    a.minX - margin < b.maxX &&
    b.minX - margin < a.maxX &&
    a.minY - margin < b.maxY &&
    b.minY - margin < a.maxY
  );
}

function labelBox(p) {
  return {
    minX: p.x - LABEL_W / 2,
    maxX: p.x + LABEL_W / 2,
    minY: p.y - LABEL_H / 2,
    maxY: p.y + LABEL_H / 2,
  };
}

/** Shortest distance from a point to an axis-aligned box (0 when inside). */
function pointBoxDistance(p, box) {
  if (!box) return Infinity;
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
  return Math.hypot(dx, dy);
}

/** Half of the label card measured along a screen direction. */
function cardHalfAlong(dir) {
  return dir.x !== 0 ? LABEL_W / 2 : LABEL_H / 2;
}

/**
 * Choose a label position for one component.
 *
 * Candidates are expressed in the COMPONENT'S OWN frame, not in screen
 * directions:
 *   - beside the symbol (perpendicular to its axis) — the conventional spot
 *   - beyond each terminal (along its axis) — fallback when the side is busy
 * The offset is derived per direction from the symbol's perpendicular extent
 * and the card's own half-size in that direction, so a horizontal resistor gets
 * a card just above it and a vertical one gets a card just beside it. Nothing
 * here depends on the component id, type-specific offsets, or the circuit.
 */
function placeLabel(comp, takenLabels, allBoxes, bounds, wireSegments = []) {
  const LABEL_GAP = 12;
  const axis = comp.axis;
  const perp = { x: -axis.y, y: axis.x };

  const besideSymbol = (dir, gap) => {
    const d = comp.symbolPerp + cardHalfAlong(dir) + gap;
    return { x: comp.center.x + dir.x * d, y: comp.center.y + dir.y * d };
  };
  const beyondTerminal = (dir) => {
    const d = comp.halfSpan + cardHalfAlong(dir) + LABEL_GAP;
    return { x: comp.center.x + dir.x * d, y: comp.center.y + dir.y * d };
  };

  const negPerp = { x: -perp.x, y: -perp.y };
  const negAxis = { x: -axis.x, y: -axis.y };

  // Off-axis corner: shifted along the component AND out to the side, so the
  // card clears a rail or lead that blocks a purely perpendicular position.
  const corner = (alongDir, sideDir) => {
    const along = Math.min(comp.halfSpan * 0.35, comp.symbolHalf + 18);
    const across = comp.symbolPerp + cardHalfAlong(sideDir) + LABEL_GAP;
    return {
      x: comp.center.x + alongDir.x * along + sideDir.x * across,
      y: comp.center.y + alongDir.y * along + sideDir.y * across,
    };
  };

  const candidates = [
    // 1. straight beside the symbol (most conventional)
    { point: besideSymbol(perp, LABEL_GAP), rank: 0, dir: perp },
    { point: besideSymbol(negPerp, LABEL_GAP), rank: 0, dir: negPerp },
    // 2. same side, one step further out
    { point: besideSymbol(perp, LABEL_GAP + 22), rank: 0, dir: perp },
    { point: besideSymbol(negPerp, LABEL_GAP + 22), rank: 0, dir: negPerp },
    // 3. off-axis corners
    { point: corner(negAxis, perp), rank: 0, dir: perp },
    { point: corner(axis, perp), rank: 0, dir: perp },
    { point: corner(negAxis, negPerp), rank: 0, dir: negPerp },
    { point: corner(axis, negPerp), rank: 0, dir: negPerp },
    // 4. beyond a terminal, only when every adjacent spot is busy
    { point: beyondTerminal(negAxis), rank: 1, dir: negAxis },
    { point: beyondTerminal(axis), rank: 1, dir: axis },
  ];

  // Convention: labels above horizontal parts and to the right of vertical
  // ones. This is only a tie-breaker, so a real collision still wins.
  const preferred = axis.x !== 0 ? { x: 0, y: -1 } : { x: 1, y: 0 };

  let best = null;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const raw = roundPoint(cand.point);
    // Score the position the card will actually occupy: clamping happens first,
    // otherwise a clipped candidate can be scored as if it were still outside.
    const p = {
      x: clamp(raw.x, LABEL_W / 2 + 6, bounds.width - LABEL_W / 2 - 6),
      y: clamp(raw.y, LABEL_H / 2 + 6, bounds.height - LABEL_H / 2 - 6),
    };
    const box = labelBox(p);
    let score = cand.rank * 120;
    if (cand.dir.x === preferred.x && cand.dir.y === preferred.y) score -= 40;

    for (const other of allBoxes) {
      if (other.compId === comp.id) continue;
      if (boxesOverlap(box, other)) score += 500;
    }
    for (const other of takenLabels) {
      if (boxesOverlap(box, other)) score += 700;
    }
    // A label card is opaque: if it sits on a wire the wire looks broken.
    for (const seg of wireSegments) {
      if (segmentHitsBox(seg.a, seg.b, box)) score += 900;
    }

    // Stay attached to its OWN component: a card nearer to a neighbouring
    // symbol than to its own reads as that neighbour's value.
    const ownGap = pointBoxDistance(p, comp.symbolBox);
    let nearestOther = Infinity;
    for (const other of allBoxes) {
      if (other.compId === comp.id) continue;
      nearestOther = Math.min(nearestOther, pointBoxDistance(p, other));
    }
    if (nearestOther < ownGap + 6) score += 400;
    score += ownGap * 8;

    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }

  takenLabels.push(labelBox(best));
  return best;
}

function planComponents(graph, comps, plan, useGeometry, project, bounds) {
  const groups = new Map();
  for (const c of comps) {
    const [t0, t1] = c.terminals;
    const na = t0?.node ?? null;
    const nb = t1?.node ?? null;
    const key = [na ?? `?${c.id}`, nb ?? `?${c.id}`].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, na, nb });
  }

  const placed = [];

  for (const [, group] of groups) {
    group.forEach((entry, index) => {
      const { c, na, nb } = entry;
      const [t0, t1] = c.terminals;
      const pa = na && plan.has(na) ? plan.get(na).point : null;
      const pb = nb && plan.has(nb) ? plan.get(nb).point : null;

      const p0 = t0?.position ? project(t0.position) : null;
      const p1 = t1?.position ? project(t1.position) : null;
      const imageCentre = c.center ? project(c.center) : null;

      let axis;
      let centre;
      let span;

      if (useGeometry && p0 && p1 && dist(p0, p1) > 6) {
        // Faithful placement: keep the image's own axis, centre and length.
        axis = dominantAxis(p1.x - p0.x, p1.y - p0.y);
        centre = imageCentre ?? mid(p0, p1);
        span = dist(p0, p1);
      } else if (useGeometry && c.orientation != null && imageCentre) {
        // Only the rotation was reported: honour it instead of guessing an axis
        // from estimated node positions.
        const rad = (c.orientation * Math.PI) / 180;
        axis = dominantAxis(Math.cos(rad), Math.sin(rad));
        centre = imageCentre;
        span = pa && pb ? dist(pa, pb) : MIN_SPAN;
      } else if (useGeometry && imageCentre && (pa || pb)) {
        const ref = pa ?? pb;
        axis = dominantAxis(imageCentre.x - ref.x, imageCentre.y - ref.y);
        centre = imageCentre;
        span = pa && pb ? dist(pa, pb) : MIN_SPAN;
      } else {
        const pA = pa ?? pb ?? { x: bounds.width / 2, y: bounds.height / 2 };
        const pB = pb ?? pa ?? { x: bounds.width / 2 + MIN_SPAN, y: bounds.height / 2 };
        axis = dominantAxis(pB.x - pA.x, pB.y - pA.y);
        centre = mid(pA, pB);
        span = dist(pA, pB) || MIN_SPAN;
      }

      // Orient the axis so terminal 0 is always on the -axis side.
      if (useGeometry && p0 && p1) {
  if (axis.x * (p1.x - p0.x) + axis.y * (p1.y - p0.y) < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }
} else if (pa && pb) {
  if (axis.x * (pb.x - pa.x) + axis.y * (pb.y - pa.y) < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }
} else if (p0 && p1) {
  if (axis.x * (p1.x - p0.x) + axis.y * (p1.y - p0.y) < 0) {
    axis = { x: -axis.x, y: -axis.y };
  }
}

      const symbolHalf = symbolHalfOf(c.type);
      const symbolPerp = symbolPerpOf(c.type);

      // In topology mode the span is derived from the node anchors, so keep a
      // visible lead on BOTH sides: a component must never end exactly on a node
      // anchor, because that hides the connection and collapses its wire to zero
      // length (the old layout did exactly this).
      if (!useGeometry && pa && pb) {
        span = Math.min(span, dist(pa, pb) - 2 * LEAD_GAP);
      }
      span = clamp(span, Math.max(2 * symbolHalf + 24, MIN_SPAN), MAX_SPAN);

      // Parallel branches between the same two nodes get their own lane.
      if (!useGeometry && group.length > 1) {
        const offset = (index - (group.length - 1) / 2) * LANE_GAP;
        centre = { x: centre.x + -axis.y * offset, y: centre.y + axis.x * offset };
      }

      const halfSpan = span / 2;
      const halfX = Math.abs(axis.x) * halfSpan + Math.abs(axis.y) * (symbolPerp + 12);
      const halfY = Math.abs(axis.y) * halfSpan + Math.abs(axis.x) * (symbolPerp + 12);
      centre = {
        x: clamp(centre.x, halfX + 8, bounds.width - halfX - 8),
        y: clamp(centre.y, halfY + 8, bounds.height - halfY - 8),
      };
      centre = roundPoint(centre);

      const t0Point = roundPoint({ x: centre.x - axis.x * halfSpan, y: centre.y - axis.y * halfSpan });
      const t1Point = roundPoint({ x: centre.x + axis.x * halfSpan, y: centre.y + axis.y * halfSpan });

      let posTerminal = null;
      if (t0.label === '+') posTerminal = 'A';
      else if (t1.label === '+') posTerminal = 'B';

      const comp = {
        id: c.id,
        type: c.type,
        value: c.value ?? null,
        confidence: c.confidence ?? 1,
        status: c.status ?? (c.confidence >= 0.85 ? 'confirmed' : c.confidence >= 0.6 ? 'probable' : 'uncertain'),
        notes: c.notes ?? null,
        center: centre,
        bbox: null,
        orientation: c.orientation ?? null,
        angle: symbolAngle(axis, [t0, t1]),
        axis,
        halfSpan,
        symbolHalf,
        symbolPerp,
        posTerminal,
        nodeA: na,
        nodeB: nb,
        x1: t0Point.x,
        y1: t0Point.y,
        x2: t1Point.x,
        y2: t1Point.y,
        terminals: [
          { label: t0.label, x: t0Point.x, y: t0Point.y, node: na, polarity: t0.label === '+' ? '+' : t0.label === '−' ? '-' : null },
          { label: t1.label, x: t1Point.x, y: t1Point.y, node: nb, polarity: t1.label === '+' ? '+' : t1.label === '−' ? '-' : null },
        ],
      };
      comp.symbolBox = componentBox(comp);
      comp.drawBox = componentDrawBox(comp);
      placed.push(comp);
    });
  }

  // Separate overlapping symbols, then place labels against the final boxes.
  resolveCollisions(placed, bounds);
  // Recompute rail anchors from final terminal positions so 3+-member node
  // wires connect to the correct location after collision resolution moved
  // components. Without this, rail anchors are stale and wires misalign.
  refreshAnchors(plan, placed);
  repositionLabels(placed, [], bounds);

  return placed;
}

/**
 * Place every label clear of component symbols, other labels and wire paths.
 * Called again after routing so labels can dodge the wires they would hide.
 */
function repositionLabels(placed, wires, bounds) {
  const wireSegments = [];
  for (const w of wires) {
    for (const seg of segmentsOf(w.points)) wireSegments.push({ a: seg[0], b: seg[1] });
  }
  const takenLabels = [];
  const boxes = placed.map((c) => ({ ...c.symbolBox, compId: c.id }));
  for (const comp of placed) {
    comp.labelPosition = placeLabel(comp, takenLabels, boxes, bounds, wireSegments);
    comp.labelBox = labelBox(comp.labelPosition);
  }
}

function refreshComponentGeometry(comp, bounds) {
  const extentX = Math.abs(comp.axis.x) * comp.halfSpan + Math.abs(comp.axis.y) * comp.symbolPerp;
  const extentY = Math.abs(comp.axis.y) * comp.halfSpan + Math.abs(comp.axis.x) * comp.symbolPerp;
  comp.center = roundPoint({
    x: clamp(comp.center.x, extentX + 8, bounds.width - extentX - 8),
    y: clamp(comp.center.y, extentY + 8, bounds.height - extentY - 8),
  });
  comp.x1 = Math.round(comp.center.x - comp.axis.x * comp.halfSpan);
  comp.y1 = Math.round(comp.center.y - comp.axis.y * comp.halfSpan);
  comp.x2 = Math.round(comp.center.x + comp.axis.x * comp.halfSpan);
  comp.y2 = Math.round(comp.center.y + comp.axis.y * comp.halfSpan);
  comp.terminals = [
    { ...comp.terminals[0], x: comp.x1, y: comp.y1 },
    { ...comp.terminals[1], x: comp.x2, y: comp.y2 },
  ];
  comp.symbolBox = componentBox(comp);
  comp.drawBox = componentDrawBox(comp);
}

/**
 * Push components apart until their full drawing boxes (symbols + leads) no
 * longer overlap. A component is only ever moved perpendicular to its own axis,
 * so its orientation and its terminal-to-node relationships stay intact.
 */
function resolveCollisions(placed, bounds) {
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!boxesOverlap(a.drawBox, b.drawBox, 8)) continue;

        const perp = { x: -b.axis.y, y: b.axis.x };
        const away = perp.x * (b.center.x - a.center.x) + perp.y * (b.center.y - a.center.y) >= 0 ? 1 : -1;
        const overlapAlong =
          Math.min(a.drawBox.maxX, b.drawBox.maxX) - Math.max(a.drawBox.minX, b.drawBox.minX);
        const overlapPerp =
          Math.min(a.drawBox.maxY, b.drawBox.maxY) - Math.max(a.drawBox.minY, b.drawBox.minY);
        const need = (b.axis.y === 0 ? overlapPerp : overlapAlong) + 18;

        // Move both components symmetrically to reduce drift toward canvas
        // edges. Each moves half the overlap along b's perpendicular, in
        // opposite directions, preserving each component's own orientation.
        const push = need * 0.5;
        b.center = { x: b.center.x + perp.x * push * away, y: b.center.y + perp.y * push * away };
        a.center = { x: a.center.x - perp.x * push * away, y: a.center.y - perp.y * push * away };
        refreshComponentGeometry(a, bounds);
        refreshComponentGeometry(b, bounds);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/**
 * Recompute rail anchor positions from the FINAL terminal positions after
 * collision resolution. Rail anchors (3+-member nodes) were initially placed
 * from pre-collision geometry; if components moved, the anchor is stale and
 * wires routed to it would misalign. This recomputes each rail anchor as the
 * centroid of its members' final terminal screen positions.
 */
function refreshAnchors(plan, placed) {
  const termPos = new Map();
  for (const comp of placed) {
    for (const t of comp.terminals) {
      termPos.set(terminalKey(comp.id, t.label), { x: t.x, y: t.y });
    }
  }
  for (const info of plan.values()) {
    if (!info.isRail) continue;
    const pts = info.members
      .map((m) => termPos.get(m.key))
      .filter(Boolean);
    if (pts.length >= 2) {
      info.point = roundPoint(centroid(pts));
    }
  }
}

/* ------------------------------------------------------------------ *\
 * Stage 3 — orthogonal wire routing
 * ------------------------------------------------------------------ */

function segmentsOf(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i += 1) segs.push([points[i], points[i + 1]]);
  return segs;
}

function segmentHitsBox(a, b, box) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > box.minX && minX < box.maxX && maxY > box.minY && minY < box.maxY;
}

function segCrossPoint(a1, a2, b1, b2) {
  const aH = Math.abs(a1.y - a2.y) <= EPS;
  const aV = Math.abs(a1.x - a2.x) <= EPS;
  const bH = Math.abs(b1.y - b2.y) <= EPS;
  const bV = Math.abs(b1.x - b2.x) <= EPS;

  if (aH && bV) {
    const x = b1.x;
    const y = a1.y;
    if (x > Math.min(a1.x, a2.x) - EPS && x < Math.max(a1.x, a2.x) + EPS &&
        y > Math.min(b1.y, b2.y) - EPS && y < Math.max(b1.y, b2.y) + EPS) {
      return { x, y };
    }
  }
  if (aV && bH) {
    const x = a1.x;
    const y = b1.y;
    if (y > Math.min(a1.y, a2.y) - EPS && y < Math.max(a1.y, a2.y) + EPS &&
        x > Math.min(b1.x, b2.x) - EPS && x < Math.max(b1.x, b2.x) + EPS) {
      return { x, y };
    }
  }
  return null;
}

function simplifyPath(points) {
  const out = [];
  for (const p of points) {
    const r = roundPoint(p);
    const last = out[out.length - 1];
    if (last && last.x === r.x && last.y === r.y) continue;
    out.push(r);
  }
  // Drop collinear middle points so the SVG has no redundant bends.
  const cleaned = [];
  for (let i = 0; i < out.length; i += 1) {
    const prev = cleaned[cleaned.length - 1];
    const next = out[i + 1];
    if (prev && next) {
      const sameX = prev.x === out[i].x && out[i].x === next.x;
      const sameY = prev.y === out[i].y && out[i].y === next.y;
      if (sameX || sameY) continue;
    }
    cleaned.push(out[i]);
  }
  return cleaned;
}

function pathLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) total += dist(points[i], points[i + 1]);
  return total;
}

function routeBetween(from, to, context) {
  if (from.x === to.x && from.y === to.y) return [from, to];

  const candidates = [];
  if (from.x === to.x || from.y === to.y) {
    candidates.push([from, to]);
  }
  candidates.push([from, { x: to.x, y: from.y }, to]);
  candidates.push([from, { x: from.x, y: to.y }, to]);
  const my = Math.round((from.y + to.y) / 2);
  const mx = Math.round((from.x + to.x) / 2);
  candidates.push([from, { x: from.x, y: my }, { x: to.x, y: my }, to]);
  candidates.push([from, { x: mx, y: from.y }, { x: mx, y: to.y }, to]);

  let best = null;
  let bestScore = Infinity;

  for (const raw of candidates) {
    const path = simplifyPath(raw);
    if (path.length < 2) continue;

    let score = pathLength(path);
    score += (path.length - 2) * 22; // gentle preference for fewer bends

    for (const [a, b] of segmentsOf(path)) {
      for (const box of context.obstacles) {
        if (context.excludeIds.includes(box.compId)) continue;
        if (segmentHitsBox(a, b, box)) score += 600;
      }
      if (a.x < 6 || a.y < 6 || a.x > context.bounds.width - 6 || a.y > context.bounds.height - 6) {
        score += 600;
      }
      for (const seg of context.existingSegments) {
        const hit = segCrossPoint(a, b, seg.a, seg.b);
        if (!hit) continue;
        const endpointOfA = dist(hit, seg.a) <= EPS || dist(hit, seg.b) <= EPS;
        const endpointOfNew = dist(hit, a) <= EPS || dist(hit, b) <= EPS;
        if (endpointOfA && endpointOfNew) score += 45;
        else if (endpointOfA || endpointOfNew) score += 400; // would look like a T junction
        else score += 70; // a real crossing: allowed, mildly penalised
      }
    }

    if (score < bestScore) {
      bestScore = score;
      best = path;
    }
  }

  return best ?? simplifyPath([from, to]);
}

function keyOf(member) {
  return member.key ?? terminalKey(member.compId, member.label);
}

function routeWires(placed, plan, bounds) {
  const obstacles = placed.map((c) => ({ ...c.symbolBox, compId: c.id }));
  const byNode = new Map();
  for (const comp of placed) {
    for (const t of comp.terminals) {
      if (!t.node) continue;
      if (!byNode.has(t.node)) byNode.set(t.node, []);
      byNode.get(t.node).push({
        key: terminalKey(comp.id, t.label),
        compId: comp.id,
        label: t.label,
        point: { x: t.x, y: t.y },
      });
    }
  }

  const wires = [];
  const existingSegments = [];
  let index = 1;

  const pushWire = (points, from, to, nodeId) => {
    const path = simplifyPath(points);
    if (path.length < 2) return;
    if (pathLength(path) < 1) return;
    const wire = {
      id: `W${index}`,
      points: path,
      from,
      to,
      node: nodeId,
      isAutoRouted: true,
      isCrossing: false,
      confidence: 1,
    };
    index += 1;
    wires.push(wire);
    for (const seg of segmentsOf(path)) existingSegments.push({ a: seg[0], b: seg[1], wireId: wire.id, node: nodeId });
  };

  for (const [nodeId, members] of byNode) {
    if (members.length === 0) continue;

    if (members.length === 1) {
      // Open terminal: draw a short, deliberate stub so it reads as unconnected
      // rather than as a floating wire.
      const member = members[0];
      const comp = placed.find((c) => c.id === member.compId);
      if (!comp) continue;
      const out = { x: comp.axis.x, y: comp.axis.y };
      const tip = roundPoint({ x: member.point.x + out.x * 18, y: member.point.y + out.y * 18 });
      pushWire([member.point, tip], member.key, `OPEN:${nodeId}`, nodeId);
      continue;
    }

    if (members.length === 2) {
      // A two-member node is a plain corner/straight run between the terminals.
      const context = {
        obstacles,
        excludeIds: [members[0].compId, members[1].compId],
        existingSegments,
        bounds,
      };
      pushWire(
        routeBetween(members[0].point, members[1].point, context),
        members[0].key,
        members[1].key,
        nodeId,
      );
      continue;
    }

    // 3+ members: a single rail anchor with a segment from every member.
    const anchor = plan.get(nodeId)?.point ?? centroid(members.map((m) => m.point));
    for (const member of members) {
      const context = { obstacles, excludeIds: [member.compId], existingSegments, bounds };
      pushWire(routeBetween(member.point, anchor, context), member.key, `NODE:${nodeId}`, nodeId);
    }
  }

  return wires;
}

/* ------------------------------------------------------------------ *\
 * Stage 4 — junctions and crossings
 * ------------------------------------------------------------------ */

function buildJunctions(plan) {
  const junctions = [];
  let idx = 1;
  for (const info of plan.values()) {
    if (!info.isRail || !info.point) continue;
    junctions.push({
      id: `J${idx}`,
      x: info.point.x,
      y: info.point.y,
      members: info.members.map((m) => keyOf(m)),
      memberCount: info.degree,
      isJunction: true,
      isRealJunction: true,
    });
    idx += 1;
  }
  return junctions;
}

function detectCrossings(wires, bounds) {
  const crossings = [];
  let idx = 1;
  for (let i = 0; i < wires.length; i += 1) {
    for (let j = i + 1; j < wires.length; j += 1) {
      const w1 = wires[i];
      const w2 = wires[j];
      if (w1.node && w2.node && w1.node === w2.node) continue;
      for (const s1 of segmentsOf(w1.points)) {
        for (const s2 of segmentsOf(w2.points)) {
          const hit = segCrossPoint(s1[0], s1[1], s2[0], s2[1]);
          if (!hit) continue;
          // Ignore shared endpoints: those are junction/terminal meetings, and
          // validateSchematic treats them as connectivity, not crossings.
          const sharedEndpoint =
            dist(hit, s1[0]) <= EPS || dist(hit, s1[1]) <= EPS ||
            dist(hit, s2[0]) <= EPS || dist(hit, s2[1]) <= EPS;
          if (sharedEndpoint) continue;
          crossings.push({
            id: `CX${idx}`,
            wireId: w1.id,
            wireBId: w2.id,
            point: { x: Math.round(hit.x), y: Math.round(hit.y) },
            confidence: 1,
          });
          idx += 1;
        }
      }
    }
  }
  return crossings;
}

/* ------------------------------------------------------------------ *\
 * Stage 5 — geometric validation
 * ------------------------------------------------------------------ */

class PointUnion {
  constructor() {
    this.parent = new Map();
  }
  key(p) {
    return `${Math.round(p.x)}:${Math.round(p.y)}`;
  }
  find(k) {
    if (!this.parent.has(k)) this.parent.set(k, k);
    if (this.parent.get(k) !== k) this.parent.set(k, this.find(this.parent.get(k)));
    return this.parent.get(k);
  }
  union(a, b) {
    const ra = this.find(this.key(a));
    const rb = this.find(this.key(b));
    if (ra !== rb) this.parent.set(ra, rb);
  }
  connected(a, b) {
    return this.find(this.key(a)) === this.find(this.key(b));
  }
}

/**
 * Validate the rendered layout itself, not the abstract graph.
 *
 * This is the check that the previous validation lacked: it verifies wire
 * continuity after layout, terminal contact, dangling ends, accidental
 * junctions, symbol/label overlap and canvas containment.
 */
export function validateSchematic(layout) {
  const errors = [];
  const warnings = [];
  const checks = [];

  if (!layout || !layout.ok) {
    return {
      isValid: false,
      errors: [layout?.message || 'Layout failed'],
      warnings: [],
      checks: ['Layout produced a renderable result'],
    };
  }

  const components = (layout.components || []).filter((c) => c.type !== 'wire');
  const wires = layout.wires || [];
  const nodes = layout.nodes || [];
  const bounds = layout.bounds || { width: 640, height: 430 };
  const uf = new PointUnion();

  // --- 1. orthogonality ---------------------------------------------------
  let orthogonal = true;
  for (const w of wires) {
    for (const [a, b] of segmentsOf(w.points)) {
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS) {
        errors.push(`Wire ${w.id} has a diagonal segment (${a.x},${a.y})→(${b.x},${b.y}).`);
        orthogonal = false;
      }
      uf.union(a, b);
    }
  }
  if (orthogonal) checks.push('Every wire segment is axis-aligned');

  // --- 2. terminal contact ------------------------------------------------
  const terminals = [];
  for (const c of components) {
    for (const t of c.terminals || []) {
      terminals.push({ key: `${c.id}.${t.label}`, point: { x: t.x, y: t.y }, node: t.node });
    }
  }

  const wireEndpoints = [];
  for (const w of wires) {
    wireEndpoints.push({ point: w.points[0], wire: w });
    wireEndpoints.push({ point: w.points[w.points.length - 1], wire: w });
  }

  for (const t of terminals) {
    if (!t.node) {
      warnings.push(`Terminal ${t.key} has no electrical node.`);
      continue;
    }
    const touched = wireEndpoints.some((e) => dist(e.point, t.point) <= 2);
    if (!touched) {
      errors.push(`Terminal ${t.key} is not touched by any wire endpoint (visible gap).`);
    }
  }
  checks.push('Every component terminal is touched by a wire endpoint');

  // --- 3. no dangling / floating endpoints --------------------------------
  const anchors = nodes.map((n) => ({ x: n.x, y: n.y }));
  for (const e of wireEndpoints) {
    const onTerminal = terminals.some((t) => dist(t.point, e.point) <= 2);
    const onAnchor = anchors.some((a) => dist(a, e.point) <= 2);
    const openStub = String(e.wire.to || '').startsWith('OPEN:');
    if (!onTerminal && !onAnchor && !openStub) {
      errors.push(`Wire ${e.wire.id} has a floating endpoint at (${e.point.x},${e.point.y}).`);
    }
  }
  checks.push('No wire endpoint floats away from a terminal or node anchor');

  // --- 4/5. graph ↔ layout agreement -------------------------------------
  const byNode = new Map();
  for (const t of terminals) {
    if (!t.node) continue;
    if (!byNode.has(t.node)) byNode.set(t.node, []);
    byNode.get(t.node).push(t);
  }

  for (const [nodeId, list] of byNode) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i += 1) {
      if (!uf.connected(list[0].point, list[i].point)) {
        errors.push(
          `Electrically connected terminals ${list[0].key} and ${list[i].key} (node ${nodeId}) are drawn disconnected.`,
        );
      }
    }
  }
  checks.push('Every electrical node is drawn as continuous geometry');

  const nodeIds = [...byNode.keys()];
  for (let i = 0; i < nodeIds.length; i += 1) {
    for (let j = i + 1; j < nodeIds.length; j += 1) {
      const a = byNode.get(nodeIds[i]);
      const b = byNode.get(nodeIds[j]);
      for (const ta of a) {
        for (const tb of b) {
          if (uf.connected(ta.point, tb.point)) {
            errors.push(
              `Terminals ${ta.key} and ${tb.key} belong to different nodes but are drawn touching (accidental short).`,
            );
          }
        }
      }
    }
  }
  checks.push('Distinct electrical nodes are never drawn touching');

  // --- 6. crossings -------------------------------------------------------
  for (let i = 0; i < wires.length; i += 1) {
    for (let j = i + 1; j < wires.length; j += 1) {
      const w1 = wires[i];
      const w2 = wires[j];
      if (w1.node && w2.node && w1.node === w2.node) continue;
      for (const s1 of segmentsOf(w1.points)) {
        for (const s2 of segmentsOf(w2.points)) {
          const hit = segCrossPoint(s1[0], s1[1], s2[0], s2[1]);
          if (!hit) continue;
          const onEnd1 = dist(hit, s1[0]) <= EPS || dist(hit, s1[1]) <= EPS;
          const onEnd2 = dist(hit, s2[0]) <= EPS || dist(hit, s2[1]) <= EPS;
          if (onEnd1 && onEnd2) continue; // shared endpoint already covered above
          if (onEnd1 || onEnd2) {
            errors.push(
              `Wire ${w1.id} ends on the middle of wire ${w2.id} at (${Math.round(hit.x)},${Math.round(hit.y)}) — this reads as a junction but is not one.`,
            );
          }
        }
      }
    }
  }
  checks.push('No wire ends on the middle of another wire');

  // --- 7. symbol overlap --------------------------------------------------
  for (let i = 0; i < components.length; i += 1) {
    for (let j = i + 1; j < components.length; j += 1) {
      const a = components[i].symbolBox;
      const b = components[j].symbolBox;
      if (a && b && boxesOverlap(a, b, 2)) {
        errors.push(`Components ${components[i].id} and ${components[j].id} overlap.`);
      }
    }
  }
  checks.push('Component symbols do not overlap');

  // --- 8. label overlap ---------------------------------------------------
  for (const c of components) {
    if (!c.labelBox) continue;
    for (const other of components) {
      if (other.id === c.id || !other.symbolBox) continue;
      if (boxesOverlap(c.labelBox, other.symbolBox, 2)) {
        warnings.push(`Label of ${c.id} overlaps component ${other.id}.`);
      }
    }
    for (const other of components) {
      if (other.id === c.id || !other.labelBox) continue;
      if (boxesOverlap(c.labelBox, other.labelBox, 0)) {
        warnings.push(`Labels of ${c.id} and ${other.id} overlap.`);
      }
    }
  }
  checks.push('Component labels are placed clear of symbols and other labels');

  // --- 9. canvas containment ---------------------------------------------
  for (const c of components) {
    if (!c.symbolBox) continue;
    if (c.symbolBox.minX < 0 || c.symbolBox.maxX > bounds.width || c.symbolBox.minY < 0 || c.symbolBox.maxY > bounds.height) {
      warnings.push(`Component ${c.id} extends outside the drawing canvas.`);
    }
  }
  for (const w of wires) {
    for (const p of w.points) {
      if (p.x < 0 || p.y < 0 || p.x > bounds.width || p.y > bounds.height) {
        errors.push(`Wire ${w.id} leaves the drawing canvas at (${p.x},${p.y}).`);
      }
    }
  }
  checks.push('Rendered geometry stays inside the canvas');

  // --- 10. node count agreement ------------------------------------------
  if (nodes.length !== byNode.size) {
    warnings.push(`Layout draws ${nodes.length} node anchors for ${byNode.size} electrical nodes.`);
  }
  checks.push('Rendered node count matches the electrical node count');

  return { isValid: errors.length === 0, errors, warnings, checks };
}

/* ------------------------------------------------------------------ *\
 * Main entry point
 * ------------------------------------------------------------------ */

/** A connection is surfaced as uncertain only when it really is uncertain. */
function connectionIsUncertain(c) {
  if (!c) return false;
  if (c.status === 'uncertain') return true;
  if (c.confidence != null && c.confidence < 0.7) return true;
  if (c.status === 'confirmed' || (c.confidence != null && c.confidence >= 0.85)) return false;
  return Boolean(c.notes) && /uncertain|possible|ambiguous|unclear|may|could/i.test(c.notes);
}

function emptyLayout() {
  const bounds = { width: 640, height: 430 };
  return {
    ok: false,
    hasGeometry: false,
    isApproximation: false,
    nodes: [],
    components: [],
    wires: [],
    routedWires: [],
    allWires: [],
    junctions: [],
    crossings: [],
    uncertain: [],
    connections: [],
    validation: { isValid: false, errors: ['No components detected'], warnings: [] },
    incomplete: true,
    bounds,
    message: 'No components were detected in the image.',
  };
}

/**
 * Convert a circuit analysis result into positioned, renderable, orthogonal
 * circuit data.
 *
 * @param {Object} analysis - backend CircuitAnalysis object
 * @returns {Object} layout consumed by CircuitDiagram
 */
export function layoutSchematic(analysis) {
  const raw = Array.isArray(analysis?.components) ? analysis.components.filter(Boolean) : [];
  if (raw.length === 0) return emptyLayout();

  const augmented = analysisWithInferredConnections(analysis);
  const graph = buildGraph(augmented);
  const comps = graph.components;
  if (comps.length === 0) return emptyLayout();

  const bounds = canvasFor(analysis);
  const project = makeProjector(bounds);

  const geometryCount = comps.filter(
    (c) => c.terminals.filter((t) => t.position).length >= 2 || c.center,
  ).length;
  const useGeometry = geometryCount / comps.length >= 0.6;

  const plan = planNodes(graph, comps, bounds, project, useGeometry);
  const components = planComponents(graph, comps, plan, useGeometry, project, bounds);
  const wires = routeWires(components, plan, bounds);
  // Re-place labels now that the wire routes are known, so a label card never
  // covers a conductor and makes it look disconnected.
  repositionLabels(components, wires, bounds);
  const junctions = buildJunctions(plan);
  const crossings = detectCrossings(wires, bounds);

  const nodes = graph.nodes.map((n) => {
    const info = plan.get(n.id);
    return {
      id: n.id,
      x: info?.point?.x ?? bounds.width / 2,
      y: info?.point?.y ?? bounds.height / 2,
      members: n.members,
      degree: info?.degree ?? n.members.length,
      isJunction: Boolean(info?.isRail),
      isRealJunction: Boolean(info?.isRail),
    };
  });

  const openNodes = nodes.filter((n) => n.degree < 2);
  const incomplete =
    Boolean(augmented.reconstruction_incomplete) ||
    openNodes.length > 0 ||
    Boolean(graph.incomplete);

  const message = incomplete
    ? 'Reconstruction is incomplete — some terminals are not connected to anything in the image.'
    : !useGeometry
      ? 'Approximate layout — original image geometry was not available. The arrangement may not match the uploaded circuit.'
      : null;

  const layout = {
    ok: true,
    hasGeometry: useGeometry,
    isApproximation: !useGeometry,
    nodes,
    components,
    wires,
    routedWires: [],
    allWires: wires,
    junctions,
    crossings,
    uncertain: (augmented.connections || [])
      .filter(connectionIsUncertain)
      .map((c) => ({
        from: `${c.from_component}.${c.from_terminal}`,
        to: `${c.to_component}.${c.to_terminal}`,
        notes: c.notes || 'Low-confidence connection.',
      })),
    connections: augmented.connections || [],
    validation: graph.validation,
    incomplete,
    bounds,
    message,
  };

  layout.renderValidation = validateSchematic(layout);
  return layout;
}

/* ------------------------------------------------------------------ *
 * Editable workspace helpers
 *
 * These let the renderer move/rotate a component and re-route its wires
 * WITHOUT touching the original analysis, the electrical graph, or the
 * initial layout. The caller stores visual edits in React state keyed by
 * component ID and applies them through applyEditToComponent + rerouteLayout.
 * ------------------------------------------------------------------ */

/**
 * Apply a visual edit (new centre and/or axis) to a single component,
 * recomputing terminal positions, angle and bounding boxes.
 *
 * @param {Object} comp  - component from the layout
 * @param {{center?:{x,y}, axis?:{x,y}}} edit
 * @returns {Object} updated component (new object, original untouched)
 */
export function applyEditToComponent(comp, edit) {
  const center = edit.center ?? comp.center;
  const axis = edit.axis ?? comp.axis;
  const halfSpan = comp.halfSpan;

  const x1 = Math.round(center.x - axis.x * halfSpan);
  const y1 = Math.round(center.y - axis.y * halfSpan);
  const x2 = Math.round(center.x + axis.x * halfSpan);
  const y2 = Math.round(center.y + axis.y * halfSpan);

  const updated = {
    ...comp,
    center: roundPoint(center),
    axis,
    x1, y1, x2, y2,
    angle: symbolAngle(axis, comp.terminals),
    terminals: (comp.terminals || []).map((t, i) => ({
      ...t,
      x: i === 0 ? x1 : x2,
      y: i === 0 ? y1 : y2,
    })),
  };
  updated.symbolBox = componentBox(updated);
  updated.drawBox = componentDrawBox(updated);
  return updated;
}

/**
 * Re-route all wires, rebuild junctions and crossings, and re-place labels
 * after one or more components have been moved or rotated.
 *
 * The electrical graph (node memberships, connections) is preserved — only
 * the geometric wire paths, anchor positions and label placements change.
 *
 * @param {Object} layout  - layout whose components have updated positions
 * @returns {Object} layout with refreshed wires, junctions, crossings, labels
 */
export function rerouteLayout(layout, nodeOverrides = null) {
  if (!layout || !layout.ok) return layout;
  const { components, bounds, nodes } = layout;

  // Rebuild the node-anchor plan from current terminal positions so rail
  // anchors follow moved components.
  const plan = new Map();
  for (const node of nodes) {
    const members = [];
    for (const comp of components) {
      for (const t of comp.terminals || []) {
        if (t.node === node.id) {
          members.push({
            key: terminalKey(comp.id, t.label),
            compId: comp.id,
            label: t.label,
            point: { x: t.x, y: t.y },
          });
        }
      }
    }
    const pts = members.map((m) => m.point);
    plan.set(node.id, {
      id: node.id,
      members,
      degree: members.length,
      isRail: members.length >= 3,
      point: members.length >= 3
        ? roundPoint(centroid(pts))
        : pts[0] ?? { x: 0, y: 0 },
    });
  }

  // Apply manual node position overrides (from user dragging a junction).
  // This only changes the visual anchor position — terminal→node membership
  // and electrical connectivity are never modified.
  if (nodeOverrides && nodeOverrides.size > 0) {
    for (const [nodeId, pos] of nodeOverrides) {
      if (plan.has(nodeId)) {
        plan.get(nodeId).point = roundPoint(pos);
      }
    }
  }

  const wires = routeWires(components, plan, bounds);
  repositionLabels(components, wires, bounds);
  const crossings = detectCrossings(wires, bounds);
  const junctions = buildJunctions(plan);

  // Update node positions to reflect overrides so node labels and junction
  // dots stay in sync.
  const updatedNodes = layout.nodes.map((n) => {
    if (plan.has(n.id)) {
      return { ...n, x: plan.get(n.id).point.x, y: plan.get(n.id).point.y };
    }
    return n;
  });

  return {
    ...layout,
    nodes: updatedNodes,
    components,
    wires,
    allWires: wires,
    junctions,
    crossings,
  };
}

/** Re-exported so callers can keep using a single import surface. */
export { computeNodes, findCycle };
