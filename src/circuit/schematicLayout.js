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
  polarityOf,
  validateGraph,
} from './electricalGraph.js';
import { PROVENANCE } from './topologyReconciliation.js';
import {
  LABEL_CARD,
  cardHalfAlong,
  labelBoxAt,
  labelSize,
  nodeLabelBox,
} from './labelMetrics.js';

/* ------------------------------------------------------------------ *\
 * Constants
 * ------------------------------------------------------------------ */

const PAD = 72;
const LANE_GAP = 96;      // perpendicular spacing between parallel branches (label room)
const MIN_SPAN = 84;      // shortest drawn component (symbol + visible leads)
const MAX_SPAN = 200;     // longest drawn component
const NODE_MIN_DIST = 170; // minimum distance between two node anchors
const LEAD_GAP = 14;      // visible lead wire that must remain on each side
const MIN_LEAD_LENGTH = 1;  // smallest visible gap between a body and its own terminal
// A reported span smaller than this fraction of the symbol it describes is not
// a length the image could have drawn: the terminals are the unreliable part, so
// the documented minimum-length policy applies and the fallback is reported.
const MIN_EVIDENCE_SCALE = 0.45;
// How far a body may be compressed along its own axis and still read as a symbol.
// Below this the body keeps its design length and overhangs its terminals instead
// of turning into a mark too small to identify.
const MIN_READABLE_SCALE = 0.85;
// How far a component's own terminal direction may sit from the line between the
// two extracted junctions it joins before that evidence is called contradictory.
const GEOMETRY_CONTRADICTION_DEG = 35;
const EPS = 0.75;
/** Size reserved for a label card that carries only an id and a value. */
const DEFAULT_LABEL_SIZE = { width: LABEL_CARD.width, height: LABEL_CARD.height };
const EDGE_PAD = 8;        // clearance kept between a component and the canvas edge
const ANCHOR_CLEARANCE = 16; // two node anchors keep this far apart
const ANCHOR_MEMBER_CLEARANCE = 6; // a dot keeps this far from its own terminals
// (a member's wire is drawn from its terminal to the dot, so only a near-zero
// gap is a defect; keeping dots 16px off their members moved extracted dots
// away from where the image put them)
const ANCHOR_NUDGE = 34;   // step used when an anchor has to be moved off something
const INCOMPLETE_MESSAGE = 'Reconstruction is incomplete — some terminals are not connected to anything in the image.';
const APPROX_MESSAGE = 'Approximate layout — original image geometry was not available. The arrangement may not match the uploaded circuit.';

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

/**
 * Unit vector along a delta, diagonals included. Used wherever the image itself
 * reported the direction of a component: a bridge arm drawn at 45 degrees must
 * stay at 45 degrees, so the axis is normalised, never snapped to a cardinal.
 */
function unitAxis(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
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

/* Wire-derived connection recovery used to live here. It now runs inside
 * `reconcileTopology()` together with explicit and NodeGroup claims, so its
 * output keeps a provenance and can be classified as confirmed or provisional.
 */

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

function separateAnchors(plan, bounds, keep = null) {
  const nodeCount = plan.size || 1;
  const minDist = Math.max(120, Math.min(240, (bounds.width - 2 * PAD) / Math.max(nodeCount, 3)));
  const placed = [];
  for (const info of plan.values()) {
    if (!info.point) continue;
    // An anchor taken from the image is evidence, not a guess: it holds its
    // position, while every guessed anchor still has to stay clear of it.
    if (keep && keep(info)) {
      placed.push(roundPoint(info.point));
      continue;
    }
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

/** Node adjacency implied by the components that bridge two nodes. */
function nodeNeighbours(comps) {
  const neighbours = new Map();
  for (const c of comps) {
    const [t0, t1] = c.terminals;
    if (!t0?.node || !t1?.node || t0.node === t1.node) continue;
    if (!neighbours.has(t0.node)) neighbours.set(t0.node, new Set());
    if (!neighbours.has(t1.node)) neighbours.set(t1.node, new Set());
    neighbours.get(t0.node).add(t1.node);
    neighbours.get(t1.node).add(t0.node);
  }
  return neighbours;
}

/**
 * Give the nodes that have no geometry at all a position derived from their
 * already-placed neighbours, instead of re-embedding the whole circuit. Nodes
 * whose members carried coordinates keep them; only the unresolved ones move.
 */
function placeMissingNodes(plan, comps, bounds) {
  const rect = { x0: PAD, y0: PAD, x1: bounds.width - PAD, y1: bounds.height - PAD };
  const neighbours = nodeNeighbours(comps);
  const taken = () => [...plan.values()].filter((p) => p.point).map((p) => p.point);

  let remaining = [...plan.values()].filter((p) => !p.point);
  for (let pass = 0; pass < 12 && remaining.length > 0; pass += 1) {
    const before = remaining.length;
    for (const info of remaining) {
      const anchorNeighbour = [...(neighbours.get(info.id) || [])]
        .map((id) => plan.get(id))
        .find((n) => n && n.point);
      if (!anchorNeighbour) continue;
      info.point = pickFreePoint(anchorNeighbour.point, taken(), rect);
      info.anchorSource = 'topological-neighbour';
    }
    remaining = remaining.filter((p) => !p.point);
    if (remaining.length === before) break;
  }

  for (const info of remaining) {
    info.point = pickFreePoint({ x: rect.x0, y: Math.round((rect.y0 + rect.y1) / 2) }, taken(), rect);
    info.anchorSource = 'topological-neighbour';
  }
}

/**
 * Is `entry` the key of a real component terminal?
 *
 * A junction's member list is free text from the extractor. Entries naming a
 * trace ("W1.to") say which wire arrives, and anything else that is not a
 * component terminal on this drawing is not membership evidence either. When the
 * caller supplies the terminal keys of the parsed circuit, only those count.
 */
function isTerminalKey(entry, terminalKeys) {
  const text = String(entry ?? '');
  if (!text || /\.(to|from)$/i.test(text)) return false;
  if (terminalKeys) return terminalKeys.has(text);
  return /^[^.]+\..+$/.test(text);
}

/**
 * An extracted junction dot for `node`, when the dot's membership actually
 * describes that node.
 *
 * The rule is about agreement, not about size: a dot may anchor a node when at
 * least two of its valid component terminals belong to that node and every
 * terminal it names belongs to it too. A dot that names only part of the node is
 * still a real joint on that node's conductor — the image simply drew the joint
 * before the third lead arrived — so it is evidence and its position is kept.
 * Requiring three members, a complete rail description or an arriving trace
 * would throw that evidence away.
 *
 * A dot that names terminals of more than one node is not evidence for either:
 * the claim is contradictory, and the caller falls back to its own estimate.
 */
function junctionAnchorFor(junctions, node, project, terminalKeys = null) {
  if (!Array.isArray(junctions) || junctions.length === 0) return null;
  const members = new Set(node.members || []);
  const candidates = [];
  for (const junction of junctions) {
    if (!junction || !junction.position) continue;
    const named = Array.isArray(junction.members) ? junction.members : [];
    const terminals = named.filter((m) => isTerminalKey(m, terminalKeys));
    const listed = terminals.filter((m) => members.has(m));
    // At least two real terminals of THIS node, and no terminal of another net.
    if (listed.length < 2 || listed.length !== terminals.length) continue;
    const point = project(junction.position);
    if (!point) continue;
    candidates.push({
      point: roundPoint(point),
      junctionId: junction.id ?? null,
      namesWholeNode: listed.length === members.size,
      arrivesWithTrace: named.length > terminals.length,
      count: listed.length,
    });
  }
  if (candidates.length === 0) return null;
  // Strongest evidence first: a dot that names the whole node, then one a traced
  // conductor arrives at, then the one naming more of the node's terminals. Ties
  // keep extraction order, so the result is deterministic.
  candidates.sort((a, b) => (
    Number(b.namesWholeNode) - Number(a.namesWholeNode) ||
    Number(b.arrivesWithTrace) - Number(a.arrivesWithTrace) ||
    b.count - a.count
  ));
  const best = candidates[0];
  // Two different dots claiming the same node in different places is a real
  // ambiguity: the stronger one is used, and the caller reports the other
  // instead of silently picking one.
  const rival = candidates.find((c) => c !== best && dist(c.point, best.point) > 1);
  return { ...best, ambiguousWith: rival ? rival.junctionId : null };
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

  const neighbours = nodeNeighbours(comps);

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
  for (const [id, point] of placed) {
    plan.get(id).point = point;
    plan.get(id).anchorSource = 'topological';
  }
}

function planNodes(graph, comps, bounds, project, hasAnyGeometry = true, junctions = [], notes = []) {
  const members = collectNodeMembers(comps, project);
  const plan = new Map();
  // The real terminal keys of this circuit, so a junction's free-text members
  // can be resolved instead of pattern-matched.
  const terminalKeys = new Set();
  for (const c of comps) {
    for (const t of c.terminals || []) terminalKeys.add(terminalKey(c.id, t.label));
  }

  for (const n of graph.nodes) {
    const list = members.get(n.id) || [];
    const pts = list.filter((m) => m.point).map((m) => m.point);
    const extracted = junctionAnchorFor(junctions, n, project, terminalKeys);
    if (extracted?.ambiguousWith) {
      notes.push(
        `Node ${n.id}: junctions ${extracted.junctionId} and ${extracted.ambiguousWith} both claim it ` +
        `at different positions; kept ${extracted.junctionId} and flagged the disagreement.`,
      );
    }
    plan.set(n.id, {
      id: n.id,
      members: list,
      degree: list.length,
      isRail: list.length >= 3,
      point: extracted ? extracted.point : pts.length ? centroid(pts) : null,
      anchorSource: extracted ? 'extracted-junction' : pts.length ? 'terminal-centroid' : null,
      junctionId: extracted ? extracted.junctionId : null,
    });
  }

  // Per-node fallback. A node is only placed topologically when it has no
  // geometry of its own; a circuit that is entirely coordinate-free still gets
  // the whole-circuit embedding, because there is nothing to preserve there.
  const missing = [...plan.values()].filter((p) => !p.point);
  if (missing.length > 0) {
    if (!hasAnyGeometry) {
      for (const info of plan.values()) {
        info.point = null;
        info.anchorSource = null;
      }
      placeNodesTopologically(plan, comps, bounds);
    } else {
      placeMissingNodes(plan, comps, bounds);
    }
  }

  // Extracted anchors are never pushed around to satisfy spacing.
  separateAnchors(plan, bounds, (info) => info.anchorSource === 'extracted-junction');
  return plan;
}

/* ------------------------------------------------------------------ *\
 * Stage 2 — component symbols
 * ------------------------------------------------------------------ */

/**
 * Does the image's own evidence disagree with itself about this component?
 *
 * Two independent measurements describe the same body: the terminal pair the
 * extractor reported, and the line joining the two junction dots the image drew
 * at the nodes those terminals belong to. Both are evidence. When they differ by
 * more than GEOMETRY_CONTRADICTION_DEG the capture is internally inconsistent and
 * nothing in it says which measurement is wrong, so the terminals are kept
 * exactly as extracted and the component is reported as geometrically uncertain.
 * The node direction is never used to rotate anything.
 *
 * Only image-drawn dots count: a centroid is a layout guess, and comparing
 * evidence against a guess proves nothing. The angle is measured on normalized
 * coordinates, so canvas scale and aspect cannot change the verdict.
 */
function geometryContradiction(comp, plan, bounds) {
  const a = comp.terminals?.[0];
  const b = comp.terminals?.[1];
  if (!a || !b || !a.node || !b.node || a.node === b.node) return null;
  const na = plan.get(a.node);
  const nb = plan.get(b.node);
  if (!na || !nb || !na.point || !nb.point) return null;
  if (na.anchorSource !== 'extracted-junction' || nb.anchorSource !== 'extracted-junction') return null;
  const width = Math.max(bounds.width - 2 * PAD, 1);
  const height = Math.max(bounds.height - 2 * PAD, 1);
  const norm = (p) => ({ x: (p.x - PAD) / width, y: (p.y - PAD) / height });
  const ta = norm(a);
  const tb = norm(b);
  const ja = norm(na.point);
  const jb = norm(nb.point);
  const termAngle = Math.atan2(tb.y - ta.y, tb.x - ta.x);
  const nodeAngle = Math.atan2(jb.y - ja.y, jb.x - ja.x);
  if (!Number.isFinite(termAngle) || !Number.isFinite(nodeAngle)) return null;
  let delta = (Math.abs(termAngle - nodeAngle) * 180) / Math.PI % 180;
  // A body has no direction of its own: ±180° describe the same line.
  if (delta > 90) delta = 180 - delta;
  if (!(delta > GEOMETRY_CONTRADICTION_DEG)) return null;
  return {
    delta,
    message:
      `its terminal direction is ${Math.round(delta)}° away from the line between the junctions ` +
      `it joins (${a.node} and ${b.node}), so the image's own geometry disagrees with itself; ` +
      `the extracted terminals are kept and the component is marked uncertain.`,
  };
}

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
  // The box must cover the body as well as the terminals: a body that overhangs
  // its terminals still occupies that room, and a dot must not land inside it.
  const along = Math.max(comp.halfSpan, comp.symbolHalf ?? 0);
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

function labelBox(p, size = DEFAULT_LABEL_SIZE) {
  return labelBoxAt(p, size);
}

/** Shortest distance from a point to an axis-aligned box (0 when inside). */
function pointBoxDistance(p, box) {
  if (!box) return Infinity;
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
  return Math.hypot(dx, dy);
}

/** The size of one component's card, always from the shared metrics. */
function sizeOf(comp) {
  const size = labelSize(comp);
  comp.labelSize = size;
  return size;
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
const LABEL_CLEARANCE = 6;
const LABEL_GAP = 12;

function placeLabel(comp, takenLabels, allBoxes, bounds, wireSegments, annotations) {
  const axis = comp.axis;
  const perp = { x: -axis.y, y: axis.x };

  const size = sizeOf(comp);

  const besideSymbol = (dir, gap, shift = 0) => {
    const d = comp.symbolPerp + cardHalfAlong(dir, size) + gap;
    return {
      x: comp.center.x + dir.x * d + axis.x * shift,
      y: comp.center.y + dir.y * d + axis.y * shift,
    };
  };
  const beyondTerminal = (dir) => {
    const d = comp.halfSpan + cardHalfAlong(dir, size) + LABEL_GAP;
    return { x: comp.center.x + dir.x * d, y: comp.center.y + dir.y * d };
  };

  const negPerp = { x: -perp.x, y: -perp.y };
  const negAxis = { x: -axis.x, y: -axis.y };

  // Off-axis corner: shifted along the component AND out to the side, so the
  // card clears a rail or lead that blocks a purely perpendicular position.
  const corner = (alongDir, sideDir) => {
    const along = Math.min(comp.halfSpan * 0.35, comp.symbolHalf + 18);
    const across = comp.symbolPerp + cardHalfAlong(sideDir, size) + LABEL_GAP;
    return {
      x: comp.center.x + alongDir.x * along + sideDir.x * across,
      y: comp.center.y + alongDir.y * along + sideDir.y * across,
    };
  };

  // The card may slide ALONG its own component to find a clear spot. In a dense
  // circuit the space directly beside a short body is often taken by a
  // neighbour, and sliding (rather than jumping to the far side of the canvas)
  // is what keeps a card unmistakably attached to the part it names. Shifts are
  // fractions of the body, so nothing here is tuned to a particular layout.
  const shifts = [0, 1, -1, 2, -2].map((step) => step * (comp.symbolHalf + cardHalfAlong(axis, size) * 0.75));

  const candidates = [];
  // 1. beside the symbol — conventional spot, nearest first, sliding outwards
  for (const gap of [LABEL_GAP, LABEL_CLEARANCE, LABEL_GAP + 22]) {
    for (const shift of shifts) {
      candidates.push({ point: besideSymbol(perp, gap, shift), rank: gap === LABEL_GAP ? 0 : 1, dir: perp });
      candidates.push({ point: besideSymbol(negPerp, gap, shift), rank: gap === LABEL_GAP ? 0 : 1, dir: negPerp });
    }
  }
  // 2. off-axis corners
  candidates.push(
    { point: corner(negAxis, perp), rank: 1, dir: perp },
    { point: corner(axis, perp), rank: 1, dir: perp },
    { point: corner(negAxis, negPerp), rank: 1, dir: negPerp },
    { point: corner(axis, negPerp), rank: 1, dir: negPerp },
  );
  // 3. beyond a terminal, only when every adjacent spot is busy
  candidates.push(
    { point: beyondTerminal(negAxis), rank: 2, dir: negAxis },
    { point: beyondTerminal(axis), rank: 2, dir: axis },
  );

  // Convention: labels above horizontal parts and to the right of vertical
  // ones. This is only a tie-breaker, so a real collision still wins.
  const preferred = axis.x !== 0 ? { x: 0, y: -1 } : { x: 1, y: 0 };

  let best = null;
  let bestScore = Infinity;
  let bestObstructions = Infinity;
  let bestCollisions = Infinity;
  function evaluate(cand) {
    const raw = roundPoint(cand.point);
    // Score the position the card will actually occupy: clamping happens first,
    // otherwise a clipped candidate can be scored as if it were still outside.
    const p = {
      x: clamp(raw.x, size.width / 2 + LABEL_CARD.edgeGap, bounds.width - size.width / 2 - LABEL_CARD.edgeGap),
      y: clamp(raw.y, size.height / 2 + LABEL_CARD.edgeGap, bounds.height - size.height / 2 - LABEL_CARD.edgeGap),
    };
    const box = labelBox(p, size);
    let score = cand.rank * 120;
    if (dist(p, comp.center) >= 80) score += 10000;
    if (cand.dir.x === preferred.x && cand.dir.y === preferred.y) score -= 40;

    const clearance = {
      minX: box.minX - LABEL_CLEARANCE, minY: box.minY - LABEL_CLEARANCE,
      maxX: box.maxX + LABEL_CLEARANCE, maxY: box.maxY + LABEL_CLEARANCE,
    };
    const collisions =
      allBoxes.filter((other) => boxesOverlap(clearance, other, 0)).length +
      takenLabels.filter((other) => boxesOverlap(clearance, other, 0)).length +
      annotations.filter((other) => boxesOverlap(clearance, other, 0)).length +
      wireSegments.filter(([a, b]) => segmentIntersectsBox(a, b, clearance)).length;
    const obstructions =
      100 * allBoxes.filter((other) => boxesOverlap(box, other, 0)).length +
      100 * takenLabels.filter((other) => boxesOverlap(box, other, 0)).length +
      annotations.filter((other) => boxesOverlap(box, other, 0)).length +
      wireSegments.filter(([a, b]) => segmentIntersectsBox(a, b, box)).length;

    // Stay attached to its OWN component: a card nearer to a neighbouring
    // symbol than to its own reads as that neighbour's value.
    const ownGap = pointBoxDistance(p, comp.symbolBox);
    let nearestOther = Infinity;
    for (const other of allBoxes) {
      if (other.compId === comp.id) continue;
      nearestOther = Math.min(nearestOther, pointBoxDistance(p, other));
    }
    if (nearestOther < ownGap + 6) score += 4000;
    score += ownGap * 8;

    if (obstructions < bestObstructions || (obstructions === bestObstructions &&
        (collisions < bestCollisions || (collisions === bestCollisions && score < bestScore)))) {
      bestObstructions = obstructions;
      bestCollisions = collisions;
      bestScore = score;
      best = p;
    }
  }
  for (const candidate of candidates) evaluate(candidate);
  if (bestCollisions > 0 || dist(best, comp.center) >= 80) {
    for (const radius of [36, 48, 60, 72]) {
      for (let step = 0; step < 16; step += 1) {
        const angle = step * Math.PI / 8;
        const dir = { x: Math.cos(angle), y: Math.sin(angle) };
        evaluate({
          point: { x: comp.center.x + radius * dir.x, y: comp.center.y + radius * dir.y },
          rank: 3,
          dir,
        });
      }
    }
  }

  takenLabels.push(labelBox(best, size));
  return best;
}

function planComponents(graph, comps, plan, project, bounds) {
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

      // Geometry is decided per component, never for the circuit as a whole: a
      // neighbour without coordinates must not drag a placed component away
      // from where the image put it.
      const placedFromImage = Boolean(
        (p0 && p1 && dist(p0, p1) > 6) || (c.orientation != null && imageCentre) || (imageCentre && (pa || pb)),
      );

      let axis;
      let centre;
      let span;
      // Did the image report this length, or is it derived from node anchors?
      const spanFromImage = Boolean(p0 && p1 && dist(p0, p1) > 6);

      if (p0 && p1 && dist(p0, p1) > 6) {
        // Faithful placement: keep the image's own axis, centre and length. The
        // axis is the direction the two terminals actually lie on, so a
        // diagonal arm stays diagonal; the centre is the midpoint of the two
        // terminals, because that is the body the terminals belong to.
        axis = unitAxis(p1.x - p0.x, p1.y - p0.y);
        centre = mid(p0, p1);
        span = dist(p0, p1);
      } else if (c.orientation != null && imageCentre) {
        // Only the rotation was reported: honour it instead of guessing an axis
        // from estimated node positions.
        const rad = (c.orientation * Math.PI) / 180;
        axis = unitAxis(Math.cos(rad), Math.sin(rad));
        centre = imageCentre;
        span = pa && pb ? dist(pa, pb) : MIN_SPAN;
      } else if (imageCentre && (pa || pb)) {
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
      if (p0 && p1) {
        if (axis.x * (p1.x - p0.x) + axis.y * (p1.y - p0.y) < 0) {
          axis = { x: -axis.x, y: -axis.y };
        }
      } else if (pa && pb) {
        if (axis.x * (pb.x - pa.x) + axis.y * (pb.y - pa.y) < 0) {
          axis = { x: -axis.x, y: -axis.y };
        }
      }

      // Two independent facts meet here: where the terminals are (evidence taken
      // from the image) and how large the body drawn between them is
      // (presentation). Only the body may adapt — a reported terminal is never
      // moved to make room for a symbol.
      const baseHalf = symbolHalfOf(c.type);
      const basePerp = symbolPerpOf(c.type);

      // When the span is derived from the node anchors, keep a visible lead on
      // BOTH sides: a component must never end exactly on a node anchor, because
      // that hides the connection and collapses its wire to zero length.
      if (!placedFromImage && pa && pb) {
        span = Math.min(span, dist(pa, pb) - 2 * LEAD_GAP);
      }

      // Can the image's own span hold this type's body with any visible lead at
      // all? If not, the reported LENGTH is the unreliable part (terminals a few
      // pixels apart cannot be the body the image drew), so the documented
      // minimum-length policy applies instead — and the fallback is reported,
      // never silent.
      const legibleSpan = 2 * baseHalf * MIN_EVIDENCE_SCALE + 2 * MIN_LEAD_LENGTH;
      const spanIsEvidence = spanFromImage && span >= legibleSpan;
      const lengthIsApproximate = spanFromImage && !spanIsEvidence;

      // A component the image placed may be as long as the canvas allows along
      // its own axis: clamping it would drag its terminals away from the
      // junctions they meet. A guessed length stays bounded by MAX_SPAN.
      const maxSpan = spanIsEvidence
        ? Math.max(
          MAX_SPAN,
          Math.abs(axis.x) * (bounds.width - 2 * PAD) + Math.abs(axis.y) * (bounds.height - 2 * PAD),
        )
        : MAX_SPAN;
      span = spanIsEvidence
        ? Math.max(span, 2 * MIN_LEAD_LENGTH)
        : clamp(span, Math.max(2 * baseHalf + 24, MIN_SPAN), maxSpan);

      // Body size. The body's PERPENDICULAR extent is what makes a symbol
      // identifiable (a zigzag's teeth, a source's plates), so it never shrinks:
      // shrinking it was what turned a short reported span into an unreadable
      // mark. Only the length between the body's ends follows the reported span,
      // and only down to a readable floor — past that the body keeps its legs and
      // overhangs its own terminals, which the leads then have to cross.
      let symbolHalf = baseHalf;
      let symbolScale = 1;
      if (spanIsEvidence) {
        const halfSpanHere = span / 2;
        const readableHalf = Math.min(baseHalf * MIN_READABLE_SCALE, baseHalf);
        symbolHalf = clamp(halfSpanHere, readableHalf, baseHalf);
        symbolScale = symbolHalf / baseHalf;
      }
      const symbolPerp = basePerp;
      // A body longer than the gap between its terminals cannot be joined by a
      // lead on each side: the terminals sit inside it. Reported, never hidden.
      const bodyOverhangs = symbolHalf > span / 2 + 0.5;

      // Parallel branches between the same two nodes get their own lane, but
      // only when their positions are guesses rather than image coordinates.
      if (!placedFromImage && group.length > 1) {
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

      // Polarity is the graph's answer, not a re-guess from the raw label: a
      // source whose terminals are named "positive"/"negative" (or "+ −" in
      // any spelling the extractor used) keeps the same side marked + through
      // layout, editing and rendering.
      let posTerminal = c.posTerminal ?? null;
      if (!posTerminal && polarityOf(t0?.label) === '+') posTerminal = 'A';
      if (!posTerminal && polarityOf(t1?.label) === '+') posTerminal = 'B';

      const comp = {
        id: c.id,
        type: c.type,
        value: c.value ?? null,
        // What the image actually printed, and whether its unit could be read.
        // Carried through so every renderer of a value can flag it.
        valueRaw: c.valueRaw ?? null,
        valueUnitRecognized: c.valueUnitRecognized ?? true,
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
        // Along-axis compression of the drawn glyph (1 = this type's design
        // length). The renderer applies it to the axis only, never to the
        // symbol's height, so a short span cannot flatten the symbol.
        symbolScale,
        // True when the body is longer than the reported terminals' gap.
        bodyOverhang: bodyOverhangs,
        // Where this component's drawn length came from: the image itself, a
        // length the image reported but that is too short to draw, or the node
        // anchors. Only the middle case is an approximation of the image.
        lengthSource: spanIsEvidence ? 'extracted' : spanFromImage ? 'short-extracted' : 'inferred',
        lengthApproximate: lengthIsApproximate,
        posTerminal,
        nodeA: na,
        nodeB: nb,
        x1: t0Point.x,
        y1: t0Point.y,
        x2: t1Point.x,
        y2: t1Point.y,
        terminals: [
          { label: t0.label, x: t0Point.x, y: t0Point.y, node: na, polarity: polarityOf(t0.label) },
          { label: t1.label, x: t1Point.x, y: t1Point.y, node: nb, polarity: polarityOf(t1.label) },
        ],
      };
      comp.symbolBox = componentBox(comp);
      comp.drawBox = componentDrawBox(comp);
      // Geometry that disagrees with itself is reported, never "fixed" by
      // rotating or shifting the component.
      const contradiction = geometryContradiction(comp, plan, bounds);
      comp.geometryUncertain = Boolean(contradiction);
      if (contradiction) comp.geometryNote = contradiction.message;
      // Remember the provenance of this position: image coordinates stay put
      // during collision resolution, estimates yield to them.
      comp.placedFromImage = placedFromImage;
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
function repositionLabels(placed, wires, bounds, nodes = [], junctions = []) {
  const wireSegments = wires.flatMap((wire) => segmentsOf(wire.points));
  const annotations = nodes.map(nodeLabelBox);
  for (const junction of junctions) {
    if (junction.isRealJunction === false) continue;
    annotations.push(labelBox(junction, { width: 12, height: 12 }));
  }
  const takenLabels = [];
  const boxes = placed.map((c) => ({ ...c.symbolBox, compId: c.id }));
  for (const comp of placed) {
    comp.labelPosition = placeLabel(comp, takenLabels, boxes, bounds, wireSegments, annotations);
    // Exactly the size the renderer will draw, from the same helper.
    comp.labelBox = labelBox(comp.labelPosition, sizeOf(comp));
  }
}

/**
 * Axis-aligned half extents of the whole drawn component (leads included), so
 * callers can keep every terminal inside the canvas.
 */
function componentExtents(comp) {
  return {
    x: Math.abs(comp.axis.x) * comp.halfSpan + Math.abs(comp.axis.y) * comp.symbolPerp,
    y: Math.abs(comp.axis.y) * comp.halfSpan + Math.abs(comp.axis.x) * comp.symbolPerp,
  };
}

/** Clamp a component centre so its drawing stays inside the canvas. */
function clampCenterToBounds(comp, center, bounds) {
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return { x: center.x, y: center.y };
  }
  const extent = componentExtents(comp);
  return {
    x: clamp(center.x, extent.x + EDGE_PAD, Math.max(extent.x + EDGE_PAD, bounds.width - extent.x - EDGE_PAD)),
    y: clamp(center.y, extent.y + EDGE_PAD, Math.max(extent.y + EDGE_PAD, bounds.height - extent.y - EDGE_PAD)),
  };
}

function refreshComponentGeometry(comp, bounds) {
  comp.center = roundPoint(clampCenterToBounds(comp, comp.center, bounds));
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
  const clearance = 8;
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (!boxesOverlap(a.drawBox, b.drawBox, clearance)) continue;

        // Only inferred positions can be displaced to resolve a collision.
        const movableA = a.placedFromImage !== true;
        const movableB = b.placedFromImage !== true;
        if (!movableA && !movableB) continue;

        let best = null;
        for (const [part, other, movable] of [[a, b, movableA], [b, a, movableB]]) {
          if (!movable) continue;
          for (const sign of [1, -1]) {
            const dx = -part.axis.y * sign;
            const dy = part.axis.x * sign;
            const separation = (delta, min, max, otherMin, otherMax) =>
              Math.abs(delta) <= Number.EPSILON ? Infinity
                : (delta > 0 ? otherMax - min + clearance : max - otherMin + clearance) / Math.abs(delta);
            const distance = 2 + Math.min(
              separation(dx, part.drawBox.minX, part.drawBox.maxX, other.drawBox.minX, other.drawBox.maxX),
              separation(dy, part.drawBox.minY, part.drawBox.maxY, other.drawBox.minY, other.drawBox.maxY),
            );
            const candidate = { ...part, center: { x: part.center.x + dx * distance, y: part.center.y + dy * distance } };
            refreshComponentGeometry(candidate, bounds);
            if (boxesOverlap(candidate.drawBox, other.drawBox, clearance)) continue;
            const shift = dist(part.center, candidate.center);
            if (!best || shift < best.shift) best = { part, candidate, shift };
          }
        }
        if (best) {
          Object.assign(best.part, best.candidate);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Two components reported at the same place.
 *
 * A schematic cannot show two symbols in one spot, and neither measurement is
 * more trustworthy than the other: the capture says both components live at that
 * point. Nothing here invents a position for either — terminals are evidence and
 * stay where the image put them — so the contradiction is reported instead of
 * being smoothed into a drawing that looks plausible and is wrong.
 */
const COINCIDENT_COMPONENT_PX = 3;

function reportCoincidentComponents(placed, notes) {
  const found = [];
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (!a.center || !b.center) continue;
      if (dist(a.center, b.center) > COINCIDENT_COMPONENT_PX) continue;
      const where = `(${Math.round(a.center.x)},${Math.round(a.center.y)})`;
      notes.push(
        `Components ${a.id} and ${b.id}: the image reports both at the same position ${where}, ` +
        `which no schematic can show. Both are drawn where the evidence put them, so the overlap ` +
        `is an extraction contradiction rather than a layout choice.`,
      );
      found.push({
        code: 'coincident-components',
        severity: 'error',
        message: `The extraction reports ${a.id} and ${b.id} at the same position ${where}.`,
        componentIds: [a.id, b.id],
      });
    }
  }
  return found;
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
    // An extracted junction position is what the image shows; recomputing a
    // centroid after collision resolution would overwrite that evidence.
    if (info.anchorSource === 'extracted-junction') continue;
    const pts = info.members
      .map((m) => termPos.get(m.key))
      .filter(Boolean);
    if (pts.length >= 2) {
      info.point = roundPoint(centroid(pts));
    }
  }
}

/* ------------------------------------------------------------------ *\
 * Stage 1b — anchor refinement for edited layouts
 *
 * When the user moves a component, its node's anchor is recomputed from the
 * new terminal positions. A raw centroid can land inside a symbol, on an
 * unrelated terminal or on another net's conductor, and a terminal that lands
 * on the anchor makes its own wire collapse to zero length. These helpers
 * keep an anchor readable without touching node membership: the electrical
 * graph is never consulted or modified, only the drawn anchor point moves.
 * ------------------------------------------------------------------ */

/**
 * Every reason `point` is unusable as a rail anchor, as a list of conflicts.
 *
 * A rail anchor must stay inside the canvas, outside every component's drawing
 * box, clear of unrelated terminals, and far enough from the node's own
 * terminals that no member wire collapses to nothing.
 *
 * This returns the reasons instead of a boolean so a position the user chose
 * can be kept and reported rather than silently corrected.
 */
function anchorConflictsAt(point, { members, comps, bounds, avoidSegments = [], taken = [] }) {
  if (!bounds) return [];
  const conflicts = [];
  const add = (code, message) => {
    if (!conflicts.some((c) => c.code === code)) conflicts.push({ code, message });
  };

  if (point.x < EDGE_PAD || point.y < EDGE_PAD) {
    add('outside-canvas', 'it is too close to the edge of the canvas');
  }
  if (point.x > bounds.width - EDGE_PAD || point.y > bounds.height - EDGE_PAD) {
    add('outside-canvas', 'it is too close to the edge of the canvas');
  }

  const memberKeys = new Set(members.map((m) => keyOf(m)));
  for (const comp of comps) {
    const box = comp.drawBox;
    if (
      box &&
      point.x > box.minX - 2 && point.x < box.maxX + 2 &&
      point.y > box.minY - 2 && point.y < box.maxY + 2
    ) {
      add('inside-symbol', 'it falls inside a component symbol');
      break;
    }
    for (const t of comp.terminals || []) {
      const isMember = memberKeys.has(terminalKey(comp.id, t.label));
      const limit = isMember ? ANCHOR_MEMBER_CLEARANCE : 2;
      if (dist(point, { x: t.x, y: t.y }) < limit) {
        add(
          isMember ? 'touching-member-terminal' : 'on-foreign-terminal',
          isMember
            ? 'it is too close to one of its own terminals, so that wire is drawn collapsed'
            : "it sits on another net's terminal",
        );
        break;
      }
    }
  }

  for (const [a, b] of avoidSegments) {
    if (pointSegmentDistance(point, a, b) <= 4) {
      add('on-foreign-wire', "it sits on another net's conductor");
      break;
    }
  }
  for (const other of taken) {
    if (dist(point, other) < ANCHOR_CLEARANCE) {
      add('on-locked-anchor', 'it overlaps another node you positioned');
      break;
    }
  }
  return conflicts;
}

/** Is `point` a usable rail anchor? */
function anchorPointIsClear(point, context) {
  return anchorConflictsAt(point, context).length === 0;
}

/**
 * Nearest usable point to `point`, searched on growing square rings so the
 * result is deterministic and never circuit-specific.
 */
function nudgeAnchor(point, context) {
  if (anchorPointIsClear(point, context)) return roundPoint(point);
  const dirs = [
    { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: -1, y: 0 },
    { x: 0, y: -1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
  ];
  for (let ring = 1; ring <= 6; ring += 1) {
    for (const d of dirs) {
      const cand = roundPoint({
        x: point.x + d.x * ANCHOR_NUDGE * ring,
        y: point.y + d.y * ANCHOR_NUDGE * ring,
      });
      if (anchorPointIsClear(cand, context)) return cand;
    }
  }
  return roundPoint(point);
}

/**
 * Refine every anchor of an edited layout: keep rail anchors out of symbols and
 * off terminals, keep each rail anchor at least `ANCHOR_CLEARANCE` from its own
 * member terminals so every member keeps a visible wire, and keep anchors from
 * landing on top of one another.
 *
 * [[anchor-stability]] Anchors of an edited layout come from real geometry
 * (the centroid of the node's own terminals), so this pass must not impose the
 * topology-stage spacing from `separateAnchors` on them: that constant exists
 * because inventing node positions for a graph has no geometric input, whereas
 * an existing drawing already says where every node is. Re-applying it moved
 * junctions the user never touched whenever any wire was rerouted. Every
 * genuine conflict is still resolved below by `nudgeAnchor`, which moves an
 * anchor only when it would draw something false (inside a symbol, on a
 * terminal, on another net's conductor, or closer than the dot clearance to an
 * already-settled anchor) — and only by the smallest ring that clears it.
 *
 * Anchors the user dragged (junctions) are authoritative and are never moved:
 * not separated from other anchors, not nudged off a symbol or a terminal, and
 * not re-routed around a conflict. Every clearance problem a locked anchor has
 * is returned to the caller, and the position is kept exactly as dropped, so
 * correcting it stays the user's decision. Only passive (auto-derived) anchors
 * are nudged.
 *
 * Priority rule: locked (user-dragged) anchors are settled FIRST, without
 * checking clearance against passive anchors. Passive anchors are settled
 * SECOND and must yield to the already-committed locked positions. This is
 * what makes refinement operate *around* a user's drop point instead of
 * against it.
 *
 * When multiple junctions are locked simultaneously (the user has dragged
 * more than one on separate gestures — nodeEdits accumulates across drags),
 * every locked anchor keeps its own requested position; one that overlaps an
 * earlier locked anchor is reported, never moved. No passive anchor is ever in
 * `taken` during Pass 1, so passives can never displace a locked anchor.
 *
 * @returns {Array<{nodeId: string, code: string, point: {x,y}, message: string}>}
 *   the conflicts that were kept rather than resolved
 */
function refineAnchors(plan, comps, bounds, locked, preserved = null) {
  const all = [...plan.values()].filter((info) => info.point);
  const conflicts = [];

  // --- Pass 1: commit locked (user-dragged) rail anchors verbatim. ---
  // A locked position is never passed through nudgeAnchor: the user's drop
  // point is the input to refinement, not a candidate refinement may improve.
  // Each locked anchor is checked against previously-committed locked
  // positions only — never against passive anchors — and anything it would
  // draw wrongly is returned as a conflict, so the drawing can report it
  // without undoing the drag. Plan-iteration order (stable Map insertion
  // order) keeps the result deterministic.
  const lockedPositions = [];
  for (const info of all) {
    if (!info.isRail) continue;
    // A junction dot extracted from the image is committed verbatim: it is not
    // a guess, so nothing about a reroute should talk it out of its position.
    // It is still settled before passive anchors, which must yield to it.
    if (preserved?.has(info.id)) {
      info.point = roundPoint(info.point);
      lockedPositions.push(info.point);
      continue;
    }
    if (!locked?.has(info.id)) continue;
    info.point = roundPoint(info.point);
    for (const conflict of anchorConflictsAt(info.point, {
      members: info.members,
      comps,
      bounds,
      taken: [...lockedPositions], // yield to earlier locked anchors only
    })) {
      conflicts.push({
        nodeId: info.id,
        code: conflict.code,
        point: { ...info.point },
        message:
          `Node ${info.id} was kept at (${info.point.x}, ${info.point.y}) where you placed it, ` +
          `although ${conflict.message}.`,
      });
    }
    lockedPositions.push(info.point);
  }

  // --- Pass 2: settle passive rail anchors, yielding to locked positions. ---
  // The `taken` list starts with the locked positions so a passive anchor
  // is nudged away from them, not the other way around.
  const taken = [...lockedPositions];
  // Non-rail passive anchors are not nudged but still register in `taken`.
  // Process in stable plan order so the result stays deterministic.
  for (const info of all) {
    // Already settled in Pass 1 (user-placed or extracted from the image).
    if (locked?.has(info.id) || preserved?.has(info.id)) continue;
    if (!info.isRail) {
      taken.push(info.point);
      continue;
    }
    info.point = nudgeAnchor(info.point, {
      members: info.members,
      comps,
      bounds,
      taken: [...taken],
    });
    taken.push(info.point);
  }

  return conflicts;
}

/**
 * A rail anchor must not sit on another net's conductor: that reads as a
 * junction the circuit does not have. Nudge any such anchor and return the
 * nodes that moved, so routing can be repeated against the new positions.
 */
function avoidForeignWireAtAnchors(plan, wires, comps, bounds, locked) {
  const moved = new Set();
  for (const info of plan.values()) {
    if (!info.isRail || !info.point || locked?.has(info.id)) continue;
    const foreign = wires.filter((w) => w.node !== info.id);
    const foreignSegments = foreign.flatMap((w) => segmentsOf(w.points));
    const onForeignWire = foreignSegments.some(
      ([a, b]) => pointSegmentDistance(info.point, a, b) <= 4,
    );
    if (!onForeignWire) continue;
    const next = nudgeAnchor(info.point, {
      members: info.members,
      comps,
      bounds,
      avoidSegments: foreignSegments,
    });
    if (dist(next, info.point) > 0.5) {
      info.point = next;
      moved.add(info.id);
    }
  }
  return moved;
}

/**
 * Put a derived node marker on a branch of its own network.
 *
 * A node anchor is either evidence (the dot the image drew, a position the user
 * dropped) or a guess (a centroid of its terminals). Either way the marker only
 * reads as a junction where at least three conductors meet: on a plain run, or
 * at a single bend, it points at a place where nothing branches, which is the
 * "dot in the middle of a wire" that looks like an invented junction. A derived
 * anchor is therefore moved onto the best meeting point of its own wires, and
 * the network is routed again so the wires actually meet there.
 *
 * Extracted dots and dragged anchors are evidence and are never moved here.
 */
// Drawn coordinates are whole canvas units; a terminal can still carry the
// fraction it was projected with, so drawn positions are keyed rounded.
const drawnKey = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;

/**
 * Where each node's own conductors touch, drawn position by drawn position.
 *
 * `ends` counts wires that stop there, `passes` counts wires that run through
 * it (a vertex in the middle of a run), and `terminals` is added by the caller
 * from the node's members.
 */
function wireTouchesByNode(wires) {
  const byNode = new Map();
  for (const w of wires) {
    if (!w.node) continue;
    if (!byNode.has(w.node)) byNode.set(w.node, new Map());
    const bucket = byNode.get(w.node);
    const last = w.points.length - 1;
    w.points.forEach((point, index) => {
      const k = drawnKey(point);
      const entry = bucket.get(k) || { ends: 0, passes: 0, point };
      if (index === 0 || index === last) entry.ends += 1;
      else entry.passes += 1;
      bucket.set(k, entry);
    });
  }
  return byNode;
}

/**
 * Is this position a place where conductors actually branch?
 *
 * Three conductors meeting is a branch. So is a conductor running *through* a
 * point while another one or a terminal joins it there: that is a tee, and a
 * marker on it sits on a real joint rather than beside one.
 */
function isBranchPoint(entry, terminalCount) {
  if (!entry) return terminalCount >= 3;
  const joins = entry.ends + terminalCount;
  return joins >= 3 || (entry.passes >= 1 && joins >= 2);
}

function settleAnchorsOnBranches(plan, wires, locked = null, allowed = true) {
  if (!allowed) return new Set();
  const pointKey = drawnKey;
  const endsByNode = wireTouchesByNode(wires);
  const moved = new Set();
  for (const info of plan.values()) {
    if (!info.isRail || !info.point) continue;
    if (info.anchorSource === 'extracted-junction' || locked?.has(info.id)) continue;
    const bucket = endsByNode.get(info.id) || new Map();
    const terminals = new Map();
    for (const member of info.members) {
      if (!member?.point) continue;
      const k = pointKey(member.point);
      terminals.set(k, (terminals.get(k) || 0) + 1);
    }
    // A meeting point is one where conductor ends and this node's own terminals
    // together reach three: two wires that merely continue each other are a
    // bend, not a junction.
    if (isBranchPoint(bucket.get(pointKey(info.point)), terminals.get(pointKey(info.point)) || 0)) continue;

    let best = null;
    for (const [k, entry] of bucket) {
      if (!isBranchPoint(entry, terminals.get(k) || 0)) continue;
      const value = entry.ends + 2 * (terminals.get(k) || 0) + entry.passes;
      const anchorDistance = dist(entry.point, info.point);
      if (!best || value > best.score || (value === best.score && anchorDistance < best.anchorDistance)) {
        best = { point: entry.point, score: value, anchorDistance };
      }
    }
    if (!best) continue;
    info.point = { x: best.point.x, y: best.point.y };
    moved.add(info.id);
  }
  return moved;
}

/** The drawn positions of already-settled anchors, as plain points. */
function fixedAnchorPoints(plan, ids) {
  return [...ids].map((id) => plan.get(id)?.point).filter(Boolean);
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

/** Clip a segment against a rectangle, including on its boundary. */
function segmentIntersectsBox(a, b, box) {
  let entry = 0;
  let exit = 1;
  for (const [start, finish, min, max] of [
    [a.x, b.x, box.minX, box.maxX], [a.y, b.y, box.minY, box.maxY],
  ]) {
    const delta = finish - start;
    if (delta === 0) {
      if (start < min || start > max) return false;
      continue;
    }
    const near = (min - start) / delta;
    const far = (max - start) / delta;
    entry = Math.max(entry, Math.min(near, far));
    exit = Math.min(exit, Math.max(near, far));
    if (entry > exit) return false;
  }
  return true;
}

function projectOntoSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return a;
  const fraction = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  return { x: a.x + fraction * dx, y: a.y + fraction * dy };
}

/** Perpendicular distance from a point to an axis-aligned segment. */
function pointSegmentDistance(p, a, b) {
  const minX = Math.min(a.x, b.x) - EPS;
  const maxX = Math.max(a.x, b.x) + EPS;
  const minY = Math.min(a.y, b.y) - EPS;
  const maxY = Math.max(a.y, b.y) + EPS;
  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return Infinity;
  if (Math.abs(a.y - b.y) <= EPS) return Math.abs(p.y - a.y);
  if (Math.abs(a.x - b.x) <= EPS) return Math.abs(p.x - a.x);
  return Infinity;
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

  // A run whose direct options all cross a symbol needs a way around it: a
  // Z-detour along one of the blocking box's four sides. Without these the
  // router has nothing clear to choose and would draw straight through.
  const lane = 12;
  // A foreign terminal sitting on the only straight run has to be walked around,
  // not merely penalised: a wire that crosses another net's terminal reads as a
  // connection the circuit does not have. Two lanes per axis are enough to clear
  // the point, and the scoring below still prefers a run that clears everything.
  // A detour is only offered when it is itself clean: a lane that runs along
  // another net's conductor, or ends on it, trades one false connection for
  // another. Several distances are tried, because the nearest clear lane may be
  // wider than the first.
  const touchesForeignConductor = (raw) => {
    const path = simplifyPath(raw);
    const start = path[0];
    const end = path[path.length - 1];
    for (const [a, b] of segmentsOf(path)) {
      for (const seg of context.existingSegments || []) {
        const hit = segCrossPoint(a, b, seg.a, seg.b);
        // Meeting another conductor at this detour's own start or end is the
        // terminal it leaves from: unavoidable and not a short.
        if (hit && dist(hit, start) > EPS && dist(hit, end) > EPS) return true;
        if (collinearOverlap(a, b, seg.a, seg.b)) return true;
      }
    }
    return false;
  };
  for (const point of context.avoidPoints || []) {
    const blocked = candidates.some((raw) => segmentsOf(simplifyPath(raw)).some(
      ([a, b]) => pointSegmentDistance(point, a, b) <= EPS,
    ));
    if (!blocked) continue;
    for (const distance of [14, 26, 40]) {
      for (const offset of [distance, -distance]) {
        const around = [
          [from, { x: point.x + offset, y: from.y }, { x: point.x + offset, y: to.y }, to],
          [from, { x: from.x, y: point.y + offset }, { x: to.x, y: point.y + offset }, to],
        ];
        for (const path of around) {
          if (touchesForeignConductor(path)) continue;
          candidates.push(path);
        }
      }
    }
  }
  for (const box of context.obstacles) {
    if (context.excludeIds.includes(box.compId)) continue;
    if (!segmentHitsBox(from, to, box) && !segmentHitsBox(from, { x: to.x, y: from.y }, box) &&
        !segmentHitsBox(from, { x: from.x, y: to.y }, box) && !segmentHitsBox({ x: to.x, y: from.y }, to, box) &&
        !segmentHitsBox({ x: from.x, y: to.y }, to, box)) continue;
    candidates.push([
      from,
      { x: box.minX - lane, y: from.y },
      { x: box.minX - lane, y: to.y },
      to,
    ]);
    candidates.push([
      from,
      { x: box.maxX + lane, y: from.y },
      { x: box.maxX + lane, y: to.y },
      to,
    ]);
    candidates.push([
      from,
      { x: from.x, y: box.minY - lane },
      { x: to.x, y: box.minY - lane },
      to,
    ]);
    candidates.push([
      from,
      { x: from.x, y: box.maxY + lane },
      { x: to.x, y: box.maxY + lane },
      to,
    ]);
  }

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
      // Never draw over another net's terminal: touching one is an accidental
      // connection, even though no wire endpoint lands there.
      for (const point of context.avoidPoints || []) {
        if (pointSegmentDistance(point, a, b) <= EPS) score += 900;
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

/** Every terminal on the canvas that is not part of this node. */
function foreignTerminalPoints(allTerminals, ownKeys) {
  return allTerminals.filter((t) => !ownKeys.has(t.key)).map((t) => t.point);
}

/** A traced path is only drawn when the model was reasonably sure of the trace. */
const EXTRACTED_WIRE_MIN_CONFIDENCE = 0.5;

/**
 * Largest wobble, in px, that still counts as axis-aligned. Schematics are drawn
 * on a grid, so a polyline that runs diagonally between two terminals is the
 * model joining endpoints with a straight line rather than tracing the
 * conductor: it is not evidence of the drawing, and routing it orthogonally is
 * more faithful than copying the shortcut.
 */
const TRACE_AXIS_TOLERANCE_PX = 2;

/** True when every segment of the projected path is horizontal or vertical. */
function traceIsAxisAligned(points) {
  for (let i = 1; i < points.length; i += 1) {
    const dx = Math.abs(points[i].x - points[i - 1].x);
    const dy = Math.abs(points[i].y - points[i - 1].y);
    if (dx > TRACE_AXIS_TOLERANCE_PX && dy > TRACE_AXIS_TOLERANCE_PX) return false;
  }
  return true;
}

/** Order-independent key for the terminal pair a wire joins. */
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ------------------------------------------------------------------ *\
 * Node networks
 *
 * A node with three or more terminals is a network, not a set of pairwise
 * connections. Its drawing is rebuilt from the electrical graph and from the
 * terminals as they are actually drawn: one shared spine through as many of
 * them as are collinear, plus one perpendicular lead for each terminal that is
 * off that spine. The junction dot rides the spine, so it marks a conductor
 * instead of hanging off a decorative stub.
 *
 * Extracted pair traces are deliberately not copied for such a node. They are
 * fragments of this one network: a fragment that stops a few pixels short of a
 * terminal, that runs past the last terminal and comes back, or that was traced
 * around the dot's extracted position, is exactly what produced loops, detours
 * and short ties. The graph says what is connected; the terminals say where;
 * the spine says how.
 * ------------------------------------------------------------------ */

/** A terminal this close to a candidate spine is treated as lying on it. */
const SPINE_TOLERANCE = 0.5;

/** How much longer than the direct run a copied trace may be. */
const TRACE_MAX_DETOUR = 2;

/** Wires shorter than this are dropped. Sub-pixel leads are still real wires. */
const MIN_WIRE_LENGTH = 0.01;

function axisPoint(axis, coord, along) {
  return axis === 'x' ? { x: along, y: coord } : { x: coord, y: along };
}

/**
 * Candidate spines for a node: both axes, through every terminal coordinate on
 * the perpendicular axis. Nothing assumes horizontal rails or vertical
 * branches — the axis and the coordinate are chosen by score, and both axes are
 * always considered.
 */
function spineCandidates(members, obstacles) {
  const candidates = [];
  for (const axis of ['x', 'y']) {
    const perp = axis === 'x' ? 'y' : 'x';
    const coords = [...new Set(members.map((m) => m.point[perp]))];
    for (const coord of coords) {
      const on = [];
      const off = [];
      for (const member of members) {
        if (Math.abs(member.point[perp] - coord) <= SPINE_TOLERANCE) on.push(member);
        else off.push(member);
      }
      if (on.length === 0) continue;
      const alongs = members.map((m) => m.point[axis]);
      const lo = Math.min(...alongs);
      const hi = Math.max(...alongs);
      const start = axisPoint(axis, coord, lo);
      const end = axisPoint(axis, coord, hi);
      candidates.push({
        axis,
        perp,
        coord,
        on,
        off,
        stubSum: off.reduce((sum, m) => sum + Math.abs(m.point[perp] - coord), 0),
        lo,
        hi,
        span: hi - lo,
        // Every symbol counts here, including the members' own: a spine drawn
        // along a terminal row grazes a body's edge and is fine, but one drawn
        // through a body is not a corridor at all.
        crossing: obstacles.some((box) => segmentHitsBox(start, end, box)),
      });
    }
  }
  // A spine drawn over a foreign symbol never wins over one that is not; after
  // that the line carrying the most terminals wins, then the shortest total
  // lead length, then the longest span (the drawn rail), then a stable
  // axis/coordinate order, so the choice is deterministic.
  candidates.sort((a, b) => (
    Number(a.crossing) - Number(b.crossing) ||
    a.off.length - b.off.length ||
    a.stubSum - b.stubSum ||
    b.span - a.span ||
    (a.axis === b.axis ? a.coord - b.coord : a.axis === 'x' ? -1 : 1)
  ));
  return candidates;
}

/**
 * Whole-path test for a copied trace: it must be a plausible drawing of the run
 * it claims, not a detour, a loop, or a line through an unrelated component.
 */
function traceIsUsable(points, a, b, obstacles) {
  if (!Array.isArray(points) || points.length < 2) return false;
  const direct = Math.abs(a.point.x - b.point.x) + Math.abs(a.point.y - b.point.y);
  if (pathLength(points) > direct * TRACE_MAX_DETOUR + 24) return false;
  if (pathCrossesItself(points)) return false;
  for (const [p, q] of segmentsOf(points)) {
    for (const box of obstacles) {
      if (box.compId === a.compId || box.compId === b.compId) continue;
      if (segmentHitsBox(p, q, box)) return false;
    }
  }
  return true;
}

/**
 * Draw one electrical node as a single connected network.
 *
 * Every member's wire ends at the node anchor, and every wire runs *along the
 * node's spine*: a member that sits on the spine connects straight to the
 * anchor, one off it gets a perpendicular lead onto the spine first. Because
 * the anchor is pulled onto the spine (an extracted dot is routinely a few
 * pixels off its conductor), the junction dot ends up on the wire it marks
 * rather than hanging below it on a stub — and the drawing is the shape the
 * circuit actually has: a rail with leads, a trunk with taps, or one corner for
 * a three-terminal bend.
 */
/**
 * Draw one electrical node as the minimum connected geometry it needs.
 *
 * The electrical graph says which terminals must be joined; the drawing says
 * where they are. This builds a chain over the node's terminals in the order
 * they appear along the inferred spine, and joins each consecutive pair with a
 * single wire routed along that spine. Every connection therefore exists
 * exactly once: no member is given a second path to a hub, and no wire covers a
 * span another wire already covers.
 *
 * The node's dot is placed on that chain, not beside it. When it sits on the
 * spine the chain is split there, so the dot is a real joint in the network it
 * marks. A dot the user positioned off the conductor keeps its position and is
 * reached by one wire from the nearest terminal.
 */
/**
 * Would this path draw over a component body or another net's terminal?
 * A wire may leave its terminal along the symbol's edge, but never through a
 * symbol and never across a terminal that belongs to a different node.
 */
function pathHitsForeignGeometry(path, obstacles, avoidPoints) {
  for (const [a, b] of segmentsOf(path)) {
    for (const box of obstacles) {
      if (segmentHitsBox(a, b, box)) return true;
    }
    for (const point of avoidPoints || []) {
      if (pointSegmentDistance(point, a, b) <= EPS) return true;
    }
  }
  return false;
}

/**
 * Do two axis-aligned segments lie on top of each other?
 *
 * A crossing is visible; two conductors sharing a run are not, and they join the
 * nets they belong to in every reading of the drawing. The router checks for
 * shared orthogonal runs using its clearance tolerance.
 */
function collinearOverlap(a, b, c, d) {
  const horizontal = Math.abs(a.y - b.y) <= EPS && Math.abs(c.y - d.y) <= EPS && Math.abs(a.y - c.y) <= EPS;
  if (horizontal) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >
      Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) + EPS;
  }
  const vertical = Math.abs(a.x - b.x) <= EPS && Math.abs(c.x - d.x) <= EPS && Math.abs(a.x - c.x) <= EPS;
  if (vertical) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) + EPS;
  }
  return false;
}

/** Return the common span, using only a floating-point tolerance for collinearity. */
function sharedSegment(a, b, c, d) {
  const length = dist(a, b);
  if (length === 0) return null;

  const axis = unitAxis(b.x - a.x, b.y - a.y);
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const dx = d.x - a.x;
  const dy = d.y - a.y;
  const tolerance = 8 * Number.EPSILON * Math.max(length, Math.abs(cx), Math.abs(cy), Math.abs(dx), Math.abs(dy));
  if (Math.abs(cx * axis.y - cy * axis.x) > tolerance ||
      Math.abs(dx * axis.y - dy * axis.x) > tolerance) return null;

  const cAlong = cx * axis.x + cy * axis.y;
  const dAlong = dx * axis.x + dy * axis.y;
  const start = Math.max(0, Math.min(cAlong, dAlong));
  const end = Math.min(length, Math.max(cAlong, dAlong));
  if (end - start <= tolerance) return null;
  return [start, end].map((along) => ({ x: a.x + along * axis.x, y: a.y + along * axis.y }));
}

/** Does any segment of this path leave both axes? */
function pathHasDiagonal(path) {
  return segmentsOf(path).some(([a, b]) => Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS);
}

/**
 * Connect a node's dot to one of its own terminals.
 *
 * Where the image drew a dot and spread its terminals around it, the drawing it
 * made is a set of spokes: each terminal reaches that dot directly. Bending
 * every spoke into an orthogonal detour invents two runs the picture never had,
 * and a diamond of arms then reads as a rectangle of rails. So a spoke is drawn
 * straight whenever a straight run crosses no other component and no other
 * net's terminal; the orthogonal route remains the fallback for a spoke that has
 * to go around something.
 */
function spokeBetween(from, to, context, ownComps, endpointComps, nodeId) {
  const straight = simplifyPath([roundPoint(from), roundPoint(to)]);
  const obstacles = context.obstacles.filter((box) => !endpointComps.has(box.compId));
  const otherNets = context.existingSegments.filter((segment) => segment.node !== nodeId);
  const clear = (path) => !pathHitsForeignGeometry(path, obstacles, context.avoidPoints) &&
    !segmentsOf(path).some(([a, b]) => otherNets.some((segment) => {
      if (sharedSegment(a, b, segment.a, segment.b)) return true;
      const hit = segCrossPoint(a, b, segment.a, segment.b);
      return hit && [a, b, segment.a, segment.b].some((point) => dist(hit, point) <= EPS);
    }));
  if (straight.length === 2) {
    const dx = Math.abs(from.x - to.x);
    const dy = Math.abs(from.y - to.y);
    const minor = Math.min(dx, dy);
    // Tight offsets on an otherwise horizontal or vertical run read more
    // cleanly as a single elbow. Keep genuine diagonal arms.
    if (minor > EPS && minor <= 18 && minor <= Math.max(dx, dy) * 0.18) {
      const elbows = [{ x: from.x, y: to.y }, { x: to.x, y: from.y }];
      for (const elbow of elbows) {
        const orthogonal = [straight[0], elbow, straight[1]];
        if (clear(orthogonal)) return orthogonal;
      }
    }
    const [a, b] = straight;
    const foreign = context.obstacles.filter((box) => !ownComps.has(box.compId));
    if (!foreign.some((box) => segmentIntersectsBox(a, b, box)) &&
        !context.avoidPoints.some((point) => dist(point, projectOntoSegment(point, a, b)) <= EPS)) {
      return straight;
    }
  }
  return routeBetween(from, to, {
    obstacles: context.obstacles,
    excludeIds: [],
    existingSegments: context.existingSegments,
    bounds: context.bounds,
    avoidPoints: context.avoidPoints,
  });
}

function buildNodeNetwork(nodeId, members, planInfo, context, pushWire, options = {}) {
  const nodeKey = `NODE:${nodeId}`;
  const ownComps = new Set(members.map((m) => m.compId));
  const spine = spineCandidates(members, context.obstacles)[0];
  if (!spine) return;

  const alongOf = (p) => p[spine.axis];
  const at = (along) => axisPoint(spine.axis, spine.coord, along);
  const alongs = members.map((m) => alongOf(m.point));
  const lo = Math.min(...alongs);
  const hi = Math.max(...alongs);

  // --- the image's own dot, when the node is a hub -------------------------
  // An extracted junction is a landmark: where the image put its dot, the node
  // really meets. When the terminals fan towards that dot instead of lying
  // along one line, the node is a hub and the dot stays exactly where it was
  // drawn, with each member reaching it (reusing an extracted conductor when
  // the image already traced that lead). When the terminals do lie along a
  // line, the chain below is the faithful drawing and the dot rides it.
  const extractedDot =
    planInfo?.anchorSource === 'extracted-junction' && planInfo.point
      ? roundPoint(planInfo.point)
      : null;
  if (extractedDot) {
    const fan = members.some(
      (m) => Math.abs(m.point[spine.perp] - spine.coord) > SPINE_TOLERANCE,
    );
    const dotOffSpine = Math.abs(extractedDot[spine.perp] - spine.coord) > SPINE_TOLERANCE;
    // A dot beyond the span of its own members is the point they hang off (a
    // corner of the drawing), not a marker riding a conductor between them: the
    // members converge on it. This is read from the positions alone, so it holds
    // for any node, any orientation and any number of members.
    const dotAlong = alongOf(extractedDot);
    const dotBeyondMembers = dotAlong < lo - SPINE_TOLERANCE || dotAlong > hi + SPINE_TOLERANCE;
    if ((fan && dotOffSpine) || dotBeyondMembers) {
      const hub = { key: nodeKey, point: extractedDot };
      // Minimum connected geometry: a spanning tree over the dot and the node's
      // terminals. Two terminals that meet the dot from the same side then
      // share one run instead of each drawing its own parallel wire into it.
      const settled = [hub];
      const pending = members.filter((m) => dist(m.point, extractedDot) >= 1);
      const order = [];
      while (pending.length > 0) {
        let best = null;
        for (const from of settled) {
          for (const member of pending) {
            // A conductor the image already traced from this terminal to its
            // dot is evidence: it wins over any cheaper invented run.
            const span =
              Math.abs(from.point.x - member.point.x) + Math.abs(from.point.y - member.point.y);
            // The dot is the node's joint, so a terminal only joins another
            // terminal when it is clearly closer to it than to the dot: that is
            // what keeps two nearly-coincident terminals from drawing parallel
            // runs into the same dot, without turning every lead into a chain.
            const cost = from.key === nodeKey
              ? (options.hasTraceTo?.(member, extractedDot, nodeKey) ? -1 : span)
              : span * 2;
            if (!best || cost < best.cost) best = { cost, from, member };
          }
        }
        order.push(best);
        settled.push(best.member);
        pending.splice(pending.indexOf(best.member), 1);
      }
      for (const { from, member } of order) {
        // The image's own conductor wins where it already runs to this dot.
        if (from.key === nodeKey && options.emitTraceTo?.(member, extractedDot, nodeId, nodeKey)) {
          continue;
        }
        const endpoints = new Set([from.compId, member.compId]);
        const spoke = options.orthogonalLeads?.has(member.key)
          ? routeBetween(from.point, member.point, { ...context, excludeIds: [] })
          : spokeBetween(from.point, member.point, context, ownComps, endpoints, nodeId);
        pushWire(
          spoke,
          from.key,
          member.key,
          nodeId,
          pathHasDiagonal(spoke) ? { spoke: true } : {},
        );
      }
      planInfo.point = extractedDot;
      return;
    }
  }

  // --- where the dot goes ------------------------------------------------
  // A dot the image drew, and a dot the user dragged, are both facts: they keep
  // their position verbatim and the wires are drawn to them. Only a dot this
  // layout invented is pulled onto the inferred spine (and kept clear of its own
  // terminals, so no member's wire collapses to nothing). Sliding an extracted
  // dot would replace image evidence with our own guess about the conductor.
  let dotPoint = null;
  if (planInfo?.point) {
    const current = roundPoint(planInfo.point);
    let along = clamp(alongOf(current), lo, hi);
    const usable = (a) => {
      const point = roundPoint(at(a));
      if (members.some((member) => dist(point, member.point) < ANCHOR_MEMBER_CLEARANCE)) return false;
      if ((options.avoidPoints || []).some((other) => dist(point, other) < ANCHOR_CLEARANCE)) return false;
      return !context.obstacles.some((box) => !ownComps.has(box.compId) &&
        point.x > box.minX - 2 && point.x < box.maxX + 2 &&
        point.y > box.minY - 2 && point.y < box.maxY + 2);
    };
    const fromImage = planInfo.anchorSource === 'extracted-junction';
    if (fromImage || options.fixedAnchors?.has(nodeId)) {
      // A position the user chose, or the image drew, is authoritative; a wire
      // reaches it, so it stays a marker on this node's network.
      dotPoint = current;
    } else {
      if (!usable(along)) {
        const slide = [1, -1, 2, -2, 3, -3]
          .map((step) => clamp(along + step * ANCHOR_CLEARANCE, lo, hi))
          .find(usable);
        if (slide !== undefined) along = slide;
      }
      // An auto-placed dot always sits on the conductor it marks, however far
      // the extraction put it from the terminals' line.
      dotPoint = roundPoint(at(along));
      planInfo.point = dotPoint;
    }
  }
  const dotOnSpine = Boolean(dotPoint) &&
    Math.abs(dotPoint[spine.perp] - spine.coord) <= SPINE_TOLERANCE;

  // --- the chain ----------------------------------------------------------
  // Sorted along the spine, so consecutive terminals are neighbours in the
  // drawing and each span is drawn once.
  const chain = members.map((member) => ({ key: member.key, point: member.point }));
  if (dotOnSpine && (planInfo.anchorSource !== 'routed-conductor' || options.lockedAnchors?.has(nodeId))) {
    chain.push({ key: nodeKey, point: dotPoint });
  }
  chain.sort((a, b) => (
    alongOf(a.point) - alongOf(b.point) || (a.key === nodeKey ? 1 : -1)
  ));

  for (let i = 1; i < chain.length; i += 1) {
    const a = chain[i - 1];
    const b = chain[i];
    // Both ends reach the spine on their own column; the span between those
    // columns is shared by nothing else. Collinear points collapse.
    let path = simplifyPath([a.point, at(alongOf(a.point)), at(alongOf(b.point)), b.point]);
    if (pathHitsForeignGeometry(path, context.obstacles, context.avoidPoints)) {
      // The spine corridor is blocked by a symbol or another net's terminal:
      // route this span around it instead of drawing through it.
      path = routeBetween(a.point, b.point, {
        obstacles: context.obstacles,
        excludeIds: [],
        existingSegments: context.existingSegments,
        bounds: context.bounds,
        avoidPoints: context.avoidPoints,
      });
    }
    pushWire(path, a.key, b.key, nodeId);
  }

  // A deliberately dragged anchor can sit off the spine. Automatically
  // generated anchors and off-spine annotations do not need a dead-end wire.
  if (dotPoint && !dotOnSpine && options.lockedAnchors?.has(nodeId) && chain.length > 0) {
    const nearest = chain.reduce((best, entry) => (
      Math.abs(alongOf(entry.point) - alongOf(dotPoint)) < Math.abs(alongOf(best.point) - alongOf(dotPoint))
        ? entry
        : best
    ), chain[0]);
    pushWire(
      routeBetween(dotPoint, nearest.point, {
        obstacles: context.obstacles,
        excludeIds: [],
        existingSegments: context.existingSegments,
        bounds: context.bounds,
        avoidPoints: context.avoidPoints,
      }),
      nodeKey,
      nearest.key,
      nodeId,
    );
  } else if (dotPoint && !dotOnSpine) {
    // Keep the editing handle on the conductor. A source marker is rendered
    // separately if the route actually reaches its extracted position.
    const nearest = context.existingSegments.reduce((best, segment) => {
      if (segment.node !== nodeId) return best;
      const point = projectOntoSegment(dotPoint, segment.a, segment.b);
      return !best || dist(dotPoint, point) < dist(dotPoint, best) ? point : best;
    }, null);
    if (nearest && dist(nearest, dotPoint) > EPS) {
      planInfo.point = nearest;
      planInfo.anchorSource = 'routed-conductor';
    }
  }
}

function routeWires(placed, plan, bounds, extractedWires = [], project = null, pinnedTraces = [], options = {}) {
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

  // Every terminal on the canvas, so a route can avoid drawing over a terminal
  // that belongs to another net.
  const allTerminals = [];
  for (const comp of placed) {
    for (const t of comp.terminals || []) {
      allTerminals.push({ key: terminalKey(comp.id, t.label), point: { x: t.x, y: t.y } });
    }
  }

  const wires = [];
  const existingSegments = [];
  let index = 1;

  // Traced paths from the analysis, keyed by the unordered terminal pair they
  // join. They are the drawing itself, so they are preferred over re-routing;
  // connections the model did not trace still get generated geometry.
  const tracesByPair = new Map();
  // Traces already resolved in layout coordinates (an edit that left their
  // components alone). Keeping them is what makes a wire override keyed on the
  // drawn wire still match after the reroute.
  for (const w of pinnedTraces || []) {
    if (!w || !w.from || !w.to || w.from === w.to) continue;
    if (!Array.isArray(w.points) || w.points.length < 2) continue;
    tracesByPair.set(pairKey(w.from, w.to), {
      from: w.from,
      to: w.to,
      points: w.points,
      pinned: true,
      id: w.id ?? null,
      confidence: w.confidence ?? 1,
    });
  }
  for (const w of extractedWires || []) {
    if (!project || !w) continue;
    if (!Array.isArray(w.points) || w.points.length < 2) continue;
    if ((w.confidence ?? 1) < EXTRACTED_WIRE_MIN_CONFIDENCE) continue;
    if (!w.from || !w.to || w.from === w.to) continue;
    const projected = w.points.map((p) => project(p));
    if (projected.some((p) => !p)) continue;
    if (pathLength(projected) < 1) continue; // zero-length / self-referential trace
    if (!traceIsAxisAligned(projected)) continue; // straight-line shortcut
    const key = pairKey(w.from, w.to);
    const prev = tracesByPair.get(key);
    if (!prev || (w.confidence ?? 1) > (prev.confidence ?? 1)) tracesByPair.set(key, w);
  }
  const usedIds = new Set();

  const pushWire = (points, from, to, nodeId, meta = {}) => {
    const path = simplifyPath(points);
    if (path.length < 2) return null;
    if (pathLength(path) < MIN_WIRE_LENGTH) return null;
    let id = meta.wireId && !usedIds.has(meta.wireId) ? meta.wireId : `W${index}`;
    while (usedIds.has(id)) {
      index += 1;
      id = `W${index}`;
    }
    usedIds.add(id);
    const wire = {
      id,
      points: path,
      from,
      to,
      node: nodeId,
      isAutoRouted: !meta.extracted,
      isExtracted: Boolean(meta.extracted),
      // A straight arm between an extracted junction and its own terminal: the
      // picture's geometry, not a generated route, so it may legitimately run
      // diagonally.
      isSpoke: Boolean(meta.spoke),
      isCrossing: false,
      confidence: meta.confidence ?? 1,
    };
    index += 1;
    wires.push(wire);
    for (const seg of segmentsOf(path)) existingSegments.push({ a: seg[0], b: seg[1], wireId: wire.id, node: nodeId });
    return wire;
  };

  // Join a drawn terminal to a traced endpoint without bending the trace. The
  // join is exactly axis-aligned: anything that is not already collinear gets
  // one orthogonal corner, so a few px of terminal drift never becomes a
  // diagonal segment (which the schematic and its editor both reject).
  const attach = (terminal, end) => {
    const dx = Math.abs(terminal.x - end.x);
    const dy = Math.abs(terminal.y - end.y);
    if (dx === 0 || dy === 0) return [end];
    return dx >= dy
      ? [{ x: end.x, y: terminal.y }, end]
      : [{ x: terminal.x, y: end.y }, end];
  };

  // A traced path only describes the drawing where its components are actually
  // drawn. When either end was placed by estimate, the image path would run
  // through unrelated terminals, so that connection is re-routed instead.
  const imagePlaced = new Set(placed.filter((c) => c.placedFromImage).map((c) => c.id));
  const traceFits = (trace, a, b) => imagePlaced.has(a.compId) && imagePlaced.has(b.compId);

  const emitTrace = (trace, a, b, nodeId) => {
    if (trace.pinned) {
      if (!traceIsUsable(trace.points, a, b, obstacles)) return false;
      const kept = pushWire(trace.points, a.key, b.key, nodeId, {
        extracted: true,
        confidence: trace.confidence,
        wireId: trace.id,
      });
      return Boolean(kept);
    }
    const pts = trace.points.map((p) => project(p)).filter(Boolean);
    if (pts.length < 2) return false;
    if (!traceFits(trace, a, b)) return false;
    const ordered = trace.from === a.key && trace.to === b.key ? pts : [...pts].reverse();
    // Extracted geometry is copied only where it is a plausible drawing of this
    // run; a detour, a loop or a line through an unrelated component is not
    // evidence of anything, so that run is routed from its terminals instead.
    if (!traceIsUsable(ordered, a, b, obstacles)) return false;
    // Every wire must begin and end exactly on its terminal: the schematic
    // validator unions wire coordinates to prove an electrical node is drawn
    // continuously, so a hairline gap would read as a broken connection.
    const path = [
      { x: a.point.x, y: a.point.y },
      ...attach(a.point, ordered[0]),
      ...ordered.slice(1, -1),
      ...attach(b.point, ordered[ordered.length - 1]).reverse(),
      { x: b.point.x, y: b.point.y },
    ];
    const wire = pushWire(path, a.key, b.key, nodeId, {
      extracted: true,
      confidence: trace.confidence ?? 1,
      wireId: trace.id ?? null,
    });
    return Boolean(wire);
  };

  // Reuse the portion of an extracted conductor leading to its node's dot.
  // Pair traces often continue past the physical junction to another terminal.
  const TRACE_DOT_TOLERANCE = 24;
  const findTraceTo = (member, target, nodeKey) => {
    if (!imagePlaced.has(member.compId)) return null;
    for (const trace of tracesByPair.values()) {
      if (trace.from !== member.key && trace.to !== member.key) continue;
      const other = trace.from === member.key ? trace.to : trace.from;
      if (other !== nodeKey && !byNode.get(nodeKey.slice(5))?.some(({ key }) => key === other)) continue;
      // A pinned trace is already in layout coordinates; a fresh one is still in
      // image coordinates and has to be projected.
      const pts = trace.pinned ? trace.points : trace.points.map((p) => project(p)).filter(Boolean);
      if (pts.length < 2) continue;
      const ordered = trace.from === member.key ? pts : [...pts].reverse();
      const hit = segmentsOf(ordered).findIndex(([a, b]) => pointSegmentDistance(target, a, b) <= EPS);
      const lead = hit >= 0 ? [...ordered.slice(0, hit + 1), target] : ordered;
      const last = lead[lead.length - 1];
      if (dist(last, target) > TRACE_DOT_TOLERANCE) continue;
      const end = { point: target, compId: nodeKey };
      const path = simplifyPath([member.point, ...attach(member.point, lead[0]), ...lead.slice(1), ...attach(last, target)]);
      if (pathHasDiagonal(path) || !traceIsUsable(path, member, end, obstacles)) continue;
      return { path, trace };
    }
    return null;
  };
  const hasTraceTo = (member, target, nodeKey) => Boolean(findTraceTo(member, target, nodeKey));
  const emitTraceTo = (member, target, nodeId, nodeKey) => {
    const found = findTraceTo(member, target, nodeKey);
    if (!found) return false;
    return Boolean(pushWire(found.path, member.key, nodeKey, nodeId, {
      extracted: true,
      confidence: found.trace.confidence ?? 1,
      wireId: found.trace.id ?? null,
    }));
  };

  for (const [nodeId, members] of byNode) {
    if (members.length === 0) continue;

    if (members.length === 1) {
      // Open terminal: draw a short, deliberate stub so it reads as unconnected
      // rather than as a floating wire.
      const member = members[0];
      const comp = placed.find((c) => c.id === member.compId);
      if (!comp) continue;
      // The stub is generated geometry, so it must be orthogonal even when the
      // component the image drew is diagonal: it points away along the body's
      // dominant direction, never on the image's own diagonal.
      const out = dominantAxis(comp.axis.x, comp.axis.y);
      const tip = roundPoint({ x: member.point.x + out.x * 18, y: member.point.y + out.y * 18 });
      pushWire([member.point, tip], member.key, `OPEN:${nodeId}`, nodeId);
      continue;
    }

    if (members.length === 2) {
      // The analysis traced this connection: draw what the image shows.
      const trace = tracesByPair.get(pairKey(members[0].key, members[1].key));
      if (trace && emitTrace(trace, members[0], members[1], nodeId)) continue;

      // Untraced: a two-member node is a plain corner/straight run.
      const context = {
        obstacles,
        excludeIds: [members[0].compId, members[1].compId],
        existingSegments,
        bounds,
        avoidPoints: foreignTerminalPoints(allTerminals, new Set(members.map((m) => m.key))),
      };
      pushWire(
        routeBetween(members[0].point, members[1].point, context),
        members[0].key,
        members[1].key,
        nodeId,
      );
      continue;
    }

    // 3+ members: the node is a drawn network, so rebuild it from the graph and
    // the actual terminals — one spine plus perpendicular leads — rather than
    // copying pair traces that stop short of terminals or hang off a dot.
    buildNodeNetwork(nodeId, members, plan.get(nodeId) ?? null, {
      obstacles,
      existingSegments,
      bounds,
      avoidPoints: foreignTerminalPoints(allTerminals, new Set(members.map((m) => m.key))),
    }, pushWire, { ...options, emitTraceTo, hasTraceTo });
  }

  return wires;
}

/* ------------------------------------------------------------------ *\
 * Stage 4 — junctions and crossings
 * ------------------------------------------------------------------ */

/**
 * A dot has to sit on the conductor it marks. Extracted positions are projected
 * onto the canvas, so a dot can drift a pixel or two off the drawn wire before it
 * is genuinely detached from it.
 */
const JUNCTION_ON_NET_TOLERANCE = 2.5;

/** Every drawn segment of each node's own conductor, by node id. */
function segmentsByNode(wires) {
  const byNode = new Map();
  for (const wire of wires) {
    if (!wire?.node || !Array.isArray(wire.points)) continue;
    if (!byNode.has(wire.node)) byNode.set(wire.node, []);
    byNode.get(wire.node).push(...segmentsOf(wire.points));
  }
  return byNode;
}

function pointOnOwnSegments(point, segments) {
  return segments.some(([a, b]) =>
    dist(point, projectOntoSegment(point, a, b)) <= JUNCTION_ON_NET_TOLERANCE);
}

/**
 * The image's junction dots, resolved to the electrical node each one marks.
 *
 * A dot is evidence for a position only when every terminal it names belongs to
 * one node and that node has at least two of them: a dot naming terminals from
 * two nets is contradictory, and one naming a single terminal says nothing about
 * where conductors branch.
 */
function extractedJunctionEvidence(junctions, graph, project, terminalKeys) {
  const evidence = [];
  for (const junction of Array.isArray(junctions) ? junctions : []) {
    if (!junction?.position || !project) continue;
    const named = Array.isArray(junction.members) ? junction.members : [];
    const terminals = named.filter((m) => isTerminalKey(m, terminalKeys));
    if (terminals.length < 2) continue;
    const owners = (graph.nodes || []).filter((node) => {
      const members = new Set(node.members || []);
      const listed = terminals.filter((m) => members.has(m));
      return listed.length >= 2 && listed.length === terminals.length;
    });
    if (owners.length !== 1) continue;
    const point = project(junction.position);
    if (!point) continue;
    evidence.push({
      nodeId: owners[0].id,
      junctionId: junction.id ?? null,
      point: roundPoint(point),
    });
  }
  return evidence;
}

/**
 * Every physical junction of every rail node.
 *
 * One electrical node can meet at several places on the drawing: a parallel
 * circuit branches at two separate tees, and a rail with a tap in the middle is
 * still one net. A junction dot is therefore a PROPERTY OF THE DRAWING (where
 * three or more of this node's own conductors meet), not of the net: each such
 * position gets its own marker, and they all resolve to the same `nodeId`.
 *
 * Exactly one marker per node is its anchor — the point the node's wires are
 * routed to and the point a drag moves (`isAnchor`). The rest are branch
 * markers: same node, own position, never moved by dragging the anchor.
 *
 * A dot the image drew is kept wherever it lies on its own conductor, even when
 * only two conductors meet there (the picture put a dot, which is evidence). A
 * dot that floats off the drawn conductor is not rendered: it would show a
 * connection at a place this layout does not connect.
 */
export function buildJunctions(plan, wires = [], evidence = [], components = []) {
  const junctions = [];
  let idx = 1;
  const touches = wireTouchesByNode(wires);
  const ownSegments = segmentsByNode(wires);
  const terminalPositions = new Map(components.flatMap((component) =>
    component.terminals.map((terminal) => [terminalKey(component.id, terminal.label), terminal])));

  for (const info of plan.values()) {
    if (!info.isRail || !info.point) continue;
    const anchor = roundPoint(info.point);
    const bucket = touches.get(info.id) || new Map();
    // An extracted position and the terminal the layout actually drew can differ
    // by a pixel or two (projection versus rounded body geometry). A dot belongs
    // to the nearest drawn meeting point, so the two are matched with tolerance
    // instead of by exact key.
    const keyAt = (point) => {
      let best = null;
      for (const [k, entry] of bucket) {
        const d = dist(entry.point, point);
        if (d <= JUNCTION_ON_NET_TOLERANCE && (!best || d < best.d)) best = { k, d };
      }
      return best ? best.k : drawnKey(point);
    };
    const anchorKey = keyAt(anchor);

    // How many of this node's own terminals arrive at each drawn position.
    const terminals = new Map();
    for (const member of info.members) {
      const point = terminalPositions.get(keyOf(member)) ?? member.point;
      if (!point) continue;
      const k = keyAt(point);
      terminals.set(k, (terminals.get(k) || 0) + 1);
    }

    const points = new Map(); // drawn key -> { point, source }
    // 1. Every place three or more of this node's conductors meet.
    for (const [k, entry] of bucket) {
      if (!isBranchPoint(entry, terminals.get(k) || 0)) continue;
      points.set(k, { point: entry.point, source: 'branch' });
    }
    // 2. Extracted dots that the drawing actually carries.
    for (const dot of evidence) {
      if (dot?.nodeId !== info.id || !dot.point) continue;
      const point = roundPoint(dot.point);
      const k = keyAt(point);
      if (points.has(k)) {
        points.get(k).source = 'extracted';
        continue;
      }
      if (!pointOnOwnSegments(point, ownSegments.get(info.id) || [])) continue;
      points.set(k, { point, source: 'extracted' });
    }
    // 3. Keep an editing handle even when the anchor is not a physical dot.
    const anchorMarker = points.get(anchorKey);
    if (anchorMarker) {
      anchorMarker.point = anchor;
      if (info.anchorSource === 'extracted-junction') anchorMarker.source = 'extracted';
    } else {
      points.set(anchorKey, {
        point: anchor,
        source: 'anchor',
      });
    }

    // The anchor marker comes first so `J#` numbering stays stable and readable.
    const ordered = [...points.entries()].sort((a, b) => (
      Number(b[0] === anchorKey) - Number(a[0] === anchorKey)
    ));
    for (const [k, entry] of ordered) {
      junctions.push({
        id: `J${idx}`,
        // The electrical node this dot draws. Renderers must key interaction on
        // `nodeId`; the visual `J#` id is only a stable React key / display name.
        nodeId: info.id,
        x: entry.point.x,
        y: entry.point.y,
        members: info.members.map((m) => keyOf(m)),
        memberCount: info.degree,
        // Where this position came from, and whether it is the node's anchor: a
        // drag moves the anchor and never another branch of the same net.
        source: entry.source,
        isAnchor: k === anchorKey,
        isJunction: true,
        isRealJunction: entry.source !== 'anchor',
      });
      idx += 1;
    }
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
      // A traced path is the image's own geometry, and a spoke joins two
      // extracted points along the picture's own arm, so both may legitimately
      // run diagonally; only invented detours must be axis-aligned.
      if (Math.abs(a.x - b.x) > EPS && Math.abs(a.y - b.y) > EPS && !w.isExtracted && !w.isSpoke) {
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

  // --- 6. crossings and shared conductors ---------------------------------
  let hasOverlap = false;
  for (let i = 0; i < wires.length; i += 1) {
    for (let j = i + 1; j < wires.length; j += 1) {
      const w1 = wires[i];
      const w2 = wires[j];
      if (w1.node && w2.node && w1.node === w2.node) continue;
      for (const s1 of segmentsOf(w1.points)) {
        for (const s2 of segmentsOf(w2.points)) {
          if (w1.node != null && w2.node != null && w1.node !== w2.node) {
            const overlap = sharedSegment(...s1, ...s2);
            if (overlap) {
              const [start, end] = overlap.map(({ x, y }) => `(${Number(x.toPrecision(12))},${Number(y.toPrecision(12))})`);
              errors.push(`Wire ${w1.id} (net ${w1.node}) and wire ${w2.id} (net ${w2.node}) overlap from ${start} to ${end}.`);
              hasOverlap = true;
              continue;
            }
          }
          const hit = segCrossPoint(s1[0], s1[1], s2[0], s2[1]);
          if (!hit) continue;
          const onEnd1 = dist(hit, s1[0]) <= EPS || dist(hit, s1[1]) <= EPS;
          const onEnd2 = dist(hit, s2[0]) <= EPS || dist(hit, s2[1]) <= EPS;
          if (onEnd1 && onEnd2) continue; // shared endpoint already covered above
          if (onEnd1 || onEnd2) {
            const found = `Wire ${w1.id} ends on the middle of wire ${w2.id} at (${Math.round(hit.x)},${Math.round(hit.y)}) — this reads as a junction but is not one.`;
            // Two traced paths meeting mid-run is what the source image draws;
            // that is a faithful transcription, not a layout defect.
            if (w1.isExtracted && w2.isExtracted) warnings.push(found);
            else errors.push(found);
          }
        }
      }
    }
  }
  checks.push('No wire ends on the middle of another wire');
  if (!hasOverlap) checks.push('Wires on distinct electrical nets do not overlap');

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
  // An inferred join is provisional by policy until geometric corroboration
  // exists, so identify it by provenance rather than by any confidence value.
  if (Array.isArray(c.provenance) && c.provenance.includes(PROVENANCE.INFERRED_WIRE)) {
    return true;
  }
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
    provisional: [],
    diagnostics: [],
    geometryNotes: [],
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
export function layoutSchematic(analysis, electricalGraph) {
  const raw = Array.isArray(analysis?.components) ? analysis.components.filter(Boolean) : [];
  if (raw.length === 0) return emptyLayout();

  // Geometric disagreements the pipeline found but did not "fix". They are
  // surfaced as render warnings instead of being silently smoothed away.
  const geometryNotes = [];

  // buildGraph reconciles every claim (explicit, wire-inferred, node group) and
  // keeps uncertain claims out of the electrical nodes.
  const graph = electricalGraph ?? buildGraph(analysis);
  const comps = graph.components;
  if (comps.length === 0) return emptyLayout();

  const bounds = canvasFor(analysis);
  const project = makeProjector(bounds);

  // Geometry is handled per component: coordinates are never thrown away
  // because some other component arrived without them.
  const hasUsableGeometry = (c) => c.terminals.filter((t) => t.position).length >= 2 || Boolean(c.center);
  const withGeometry = comps.filter(hasUsableGeometry);
  const coverage = comps.length > 0 ? withGeometry.length / comps.length : 0;
  const geometry = {
    covered: withGeometry.length,
    total: comps.length,
    coverage,
    missingComponentIds: comps.filter((c) => !hasUsableGeometry(c)).map((c) => c.id),
  };

  const plan = planNodes(graph, comps, bounds, project, withGeometry.length > 0, graph.junctions, geometryNotes);
  const components = planComponents(graph, comps, plan, project, bounds);
  const contradictions = reportCoincidentComponents(components, geometryNotes);
  // Geometry the image reported and geometry the layout had to approximate are
  // reported separately, so a reader can tell what was drawn from evidence.
  for (const comp of components) {
    if (comp.lengthApproximate) {
      geometryNotes.push(
        `Component ${comp.id}: its extracted terminals are too close together to hold its symbol, ` +
        `so its length is drawn from the layout minimum instead of the image.`,
      );
    }
    if (comp.geometryUncertain && comp.geometryNote) {
      geometryNotes.push(`Component ${comp.id}: ${comp.geometryNote}`);
    }
    if (comp.bodyOverhang) {
      geometryNotes.push(
        `Component ${comp.id}: the image reported a span shorter than its symbol, so the symbol is ` +
        `drawn at a readable size and extends past its own terminals.`,
      );
    }
  }
  // The same anchor policy the editor uses, applied to the first render too:
  // a dot may not land inside a symbol, on a foreign terminal, or so close to
  // its own terminal that the member's wire is drawn collapsed. Dots the image
  // reported are committed verbatim: they are evidence, not a guess.
  const extractedAnchors = new Set(
    [...plan.values()].filter((i) => i.anchorSource === 'extracted-junction').map((i) => i.id),
  );
  refineAnchors(plan, components, bounds, new Set(), extractedAnchors);
  let wires = routeWires(components, plan, bounds, graph.wires, project);
  // An anchor that lands on another net's conductor would draw a junction the
  // circuit does not have. Settle those and route again, exactly as the editor
  // does, so the first render is as honest as every later one.
  const settled = new Set();
  for (let pass = 0; pass < 2; pass += 1) {
    const moved = avoidForeignWireAtAnchors(plan, wires, components, bounds, settled);
    if (moved.size === 0) break;
    for (const id of moved) settled.add(id);
    wires = routeWires(components, plan, bounds, graph.wires, project, [], {
      fixedAnchors: settled,
      avoidPoints: fixedAnchorPoints(plan, settled),
    });
  }
  // A marker that the layout guessed belongs where its wires actually branch,
  // and the wires are drawn again so they meet it there.
  for (let pass = 0; pass < 2; pass += 1) {
    // Only a drawing that has geometry of its own can be settled: a
    // coordinate-free circuit has no picture to preserve, and moving its
    // invented anchors on every route would make the drawing churn.
    const moved = settleAnchorsOnBranches(plan, wires, settled, withGeometry.length > 0);
    if (moved.size === 0) break;
    for (const id of moved) settled.add(id);
    wires = routeWires(components, plan, bounds, graph.wires, project, [], {
      fixedAnchors: settled,
      avoidPoints: fixedAnchorPoints(plan, settled),
    });
  }
  const terminalKeys = new Set(comps.flatMap(
    (c) => (c.terminals || []).map((t) => terminalKey(c.id, t.label)),
  ));
  const junctionEvidence = extractedJunctionEvidence(graph.junctions, graph, project, terminalKeys);
  const junctions = buildJunctions(plan, wires, junctionEvidence, components);
  // A dot the drawing does not carry is reported rather than drawn floating:
  // a marker off its own conductor would show a connection this layout does not
  // make.
  for (const dot of junctionEvidence) {
    const drawn = junctions.some((j) => j.isRealJunction && j.nodeId === dot.nodeId
      && Math.hypot(j.x - dot.point.x, j.y - dot.point.y) <= JUNCTION_ON_NET_TOLERANCE);
    if (drawn) continue;
    geometryNotes.push(
      `Junction ${dot.junctionId ?? '(unnamed)'} of node ${dot.nodeId}: its position is not on the drawn ` +
      `conductor for that net, so no marker is drawn there.`,
    );
  }
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
      // Provenance of the anchor, so an edit can tell an extracted junction dot
      // apart from a position the layout had to guess.
      anchorSource: info?.anchorSource ?? null,
    };
  });
  repositionLabels(components, wires, bounds, nodes, junctions);

  const openNodes = nodes.filter((n) => n.degree < 2);
  const incomplete =
    Boolean(analysis?.reconstruction_incomplete) ||
    openNodes.length > 0 ||
    Boolean(graph.incomplete);

  const message = incomplete
    ? INCOMPLETE_MESSAGE
    : coverage < 1
      ? APPROX_MESSAGE
      : null;

  const layout = {
    ok: true,
    hasGeometry: withGeometry.length > 0,
    // The warning now reflects real coverage: any component that had to be
    // estimated raises it, and `geometry` names the ones that did.
    isApproximation: coverage < 1,
    geometry,
    nodes,
    components,
    wires,
    routedWires: [],
    allWires: wires,
    junctions,
    crossings,
    uncertain: [...(graph.connections || []), ...(graph.provisional || [])]
      .filter(connectionIsUncertain)
      .map((c) => ({
        from: `${c.from_component}.${c.from_terminal}`,
        to: `${c.to_component}.${c.to_terminal}`,
        notes: c.notes || 'Low-confidence connection.',
      })),
    connections: graph.connections || [],
    // Claims withheld from the electrical graph (uncertain / low-confidence).
    provisional: graph.provisional || [],
    diagnostics: [...(graph.diagnostics || []), ...contradictions],
    geometryNotes,
    validation: graph.validation,
    incomplete,
    bounds,
    message,
  };

  layout.renderValidation = validateSchematic(layout);
  if (geometryNotes.length > 0) layout.renderValidation.warnings.push(...geometryNotes);
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

/* ------------------------------------------------------------------ *
 * Manual wire-segment geometry overrides
 *
 * A wire's `points` are drawing geometry only: connectivity lives in the
 * electrical graph and on each terminal's `node`. These helpers therefore
 * move one segment while leaving both endpoints exactly where they were, so a
 * drag can never create, split or merge an electrical node.
 * ------------------------------------------------------------------ */

/** Shortest a neighbouring segment may become when a segment is shifted. */
const MIN_ADJACENT_LENGTH = 4;

/**
 * Stable identity of a wire across re-routes. The positional `id` (`W3`) is
 * reassigned on every route, so overrides must never be keyed by it.
 */
export function wireOverrideKey(wire) {
  if (!wire) return null;
  return `${wire.node ?? ''}|${wire.from ?? ''}|${wire.to ?? ''}`;
}

/**
 * Find the axis-aligned polyline segment nearest to `point`.
 *
 * `includeEnds` decides whether the first and last segment — the two that
 * touch the wire's own endpoints — may be returned. They are handled
 * differently by `shiftWireSegment` because moving one must not detach the
 * terminal/junction/anchor it is drawn connected to.
 *
 * @param {Array<{x,y}>} points - wire polyline
 * @param {{x,y}} point - pointer position in SVG space
 * @param {number} tolerance - maximum perpendicular distance in px
 * @param {boolean} includeEnds - consider the two endpoint-touching segments
 * @returns {{index:number, dir:'h'|'v', coord:number, span:[number,number],
 *   end:'start'|'end'|null}|null}
 */
function segmentAt(points, point, tolerance, includeEnds) {
  if (!Array.isArray(points) || points.length < 2 || !point) return null;
  const from = includeEnds ? 0 : 1;
  const to = includeEnds ? points.length - 2 : points.length - 3;

  let best = null;
  for (let i = from; i <= to; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const horizontal = a.y === b.y;
    if (!horizontal && a.x !== b.x) continue; // diagonal segments are never draggable

    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const along = horizontal ? point.x : point.y;
    if (along < lo - tolerance || along > hi + tolerance) continue;

    const distance = Math.abs(horizontal ? point.y - a.y : point.x - a.x);
    if (distance > tolerance) continue;

    const better =
      !best ||
      distance < best.distance - 0.01 ||
      (Math.abs(distance - best.distance) <= 0.01 && hi - lo > best.length);
    if (better) {
      best = {
        index: i,
        dir: horizontal ? 'h' : 'v',
        coord: horizontal ? a.y : a.x,
        span: [lo, hi],
        distance,
        length: hi - lo,
      };
    }
  }

  if (!best) return null;
  const end = best.index === 0 ? 'start' : best.index === points.length - 2 ? 'end' : null;
  return { index: best.index, dir: best.dir, coord: best.coord, span: best.span, end };
}

/**
 * Find a draggable interior segment under `point`.
 *
 * Only segments with a bend at both ends qualify here. The first and last
 * segment touch a component terminal, a junction anchor or an open-stub tip;
 * `wireSegmentAt` handles those, leaving the endpoint itself fixed.
 *
 * @param {Array<{x,y}>} points - wire polyline
 * @param {{x,y}} point - pointer position in SVG space
 * @param {number} tolerance - maximum perpendicular distance in px
 * @returns {{index:number, dir:'h'|'v', coord:number, span:[number,number]}|null}
 */
export function interiorSegmentAt(points, point, tolerance = 10) {
  const segment = segmentAt(points, point, tolerance, false);
  if (!segment) return null;
  const { index, dir, coord, span } = segment;
  return { index, dir, coord, span };
}

/**
 * Find any draggable segment under `point`, including the two segments that
 * touch the wire's endpoints. This is what the renderer hit-tests with: an
 * L-shaped wire has only those two, so excluding them made it undraggable.
 *
 * @param {Array<{x,y}>} points - wire polyline
 * @param {{x,y}} point - pointer position in SVG space
 * @param {number} tolerance - maximum perpendicular distance in px
 * @returns {{index:number, dir:'h'|'v', coord:number, span:[number,number],
 *   end:'start'|'end'|null}|null}
 */
export function wireSegmentAt(points, point, tolerance = 10) {
  return segmentAt(points, point, tolerance, true);
}

/** Shortest a segment of a rebuilt path may become. */
const MIN_SEGMENT_LENGTH = 1;

/** Drop consecutive duplicate points left behind by collinear simplification. */
function trimDuplicatePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push(p);
  }
  return out;
}

/** Does the path cross over one of its own distant segments? */
function pathCrossesItself(points) {
  const segs = segmentsOf(points);
  for (let i = 0; i < segs.length; i += 1) {
    for (let j = i + 2; j < segs.length; j += 1) {
      if (segCrossPoint(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return true;
    }
  }
  return false;
}

/**
 * A shifted path is only usable if it still joins the same two points, stays
 * orthogonal, has no collapsed segments and does not fold over itself.
 */
function isUsablePath(candidate, original) {
  if (!Array.isArray(candidate) || candidate.length < 2) return false;

  const srcFirst = original[0];
  const srcLast = original[original.length - 1];
  const first = candidate[0];
  const tail = candidate[candidate.length - 1];
  if (Math.abs(first.x - srcFirst.x) > EPS || Math.abs(first.y - srcFirst.y) > EPS) return false;
  if (Math.abs(tail.x - srcLast.x) > EPS || Math.abs(tail.y - srcLast.y) > EPS) return false;

  for (let i = 0; i < candidate.length - 1; i += 1) {
    const a = candidate[i];
    const b = candidate[i + 1];
    if (a.x !== b.x && a.y !== b.y) return false; // diagonal segment
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < MIN_SEGMENT_LENGTH) return false;
  }

  return !pathCrossesItself(candidate);
}

/**
 * Move one segment perpendicular to its own direction.
 *
 * Interior segments simply move their two bend points and the neighbouring
 * segments stretch. A segment that touches a wire endpoint (an L-shaped
 * wire's two arms, or either end of a longer route) cannot slide, because
 * that endpoint is what the wire is drawn connected to: the path instead
 * gains a pair of bends, so the segment's own run moves to `coord` while the
 * endpoint stays exactly where it was. Redundant corners are then simplified
 * away.
 *
 * @returns {Array<{x,y}>|null} new points, or null when the segment is
 *   diagonal, unchanged, would collapse a neighbour, or would produce an
 *   invalid (non-orthogonal, degenerate or self-crossing) path.
 */
export function shiftWireSegment(points, index, coord) {
  if (!Array.isArray(points) || points.length < 2) return null;
  if (!Number.isFinite(coord)) return null;
  if (!Number.isInteger(index) || index < 0 || index > points.length - 2) return null;

  const a = points[index];
  const b = points[index + 1];
  const horizontal = a.y === b.y;
  if (!horizontal && a.x !== b.x) return null;
  if (Math.abs(coord - (horizontal ? a.y : a.x)) < 0.5) return null;

  const endSegment = index === 0 || index === points.length - 2;

  if (!endSegment) {
    const before = points[index - 1];
    const after = points[index + 2];
    if (horizontal) {
      if (Math.abs(before.y - coord) < MIN_ADJACENT_LENGTH) return null;
      if (Math.abs(after.y - coord) < MIN_ADJACENT_LENGTH) return null;
    } else {
      if (Math.abs(before.x - coord) < MIN_ADJACENT_LENGTH) return null;
      if (Math.abs(after.x - coord) < MIN_ADJACENT_LENGTH) return null;
    }

    const moved = points.map((p, i) => {
      if (i !== index && i !== index + 1) return { x: p.x, y: p.y };
      return horizontal ? { x: p.x, y: coord } : { x: coord, y: p.y };
    });
    return isUsablePath(moved, points) ? moved : null;
  }

  // Endpoint-touching segment: insert the detour, then let simplifyPath drop
  // the corner that the detour makes redundant (it may land on the next bend).
  const p1 = horizontal ? { x: a.x, y: coord } : { x: coord, y: a.y };
  const p2 = horizontal ? { x: b.x, y: coord } : { x: coord, y: b.y };
  const candidate = trimDuplicatePoints(simplifyPath([
    ...points.slice(0, index + 1),
    p1,
    p2,
    ...points.slice(index + 1),
  ]));

  return isUsablePath(candidate, points) ? candidate : null;
}

/**
 * Locate the segment an override refers to in a freshly routed path.
 * Matching uses direction and span overlap, so it survives the point-index
 * shifts that a re-route can introduce. When the override remembers which end
 * of the wire it came from, a segment in the same position wins over one that
 * merely shares its span. A path that changed too much simply yields no match
 * and the override is dropped.
 */
function matchOverrideSegment(points, override) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let best = null;

  for (let i = 0; i <= points.length - 2; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const horizontal = a.y === b.y;
    if (!horizontal && a.x !== b.x) continue;
    if ((horizontal ? 'h' : 'v') !== override.dir) continue;

    const lo = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const hi = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const overlap = Math.min(hi, override.span[1]) - Math.max(lo, override.span[0]);
    if (overlap <= 0) continue;

    const kind = i === 0 ? 'start' : i === points.length - 2 ? 'end' : null;
    const sameKind = (override.end ?? kind) === kind ? 1 : 0;
    const better =
      !best ||
      sameKind > best.sameKind ||
      (sameKind === best.sameKind && overlap > best.overlap);
    if (better) best = { index: i, overlap, sameKind };
  }

  if (!best) return null;
  const wanted = override.span[1] - override.span[0];
  if (wanted > 0 && best.overlap < wanted * 0.6) return null;
  return best;
}

/**
 * Apply manual segment offsets to freshly routed wires.
 *
 * Overrides are keyed by `wireOverrideKey` and describe a segment by direction
 * and span, never by positional wire id or point index. An override whose
 * segment no longer exists is ignored, leaving the wire auto-routed.
 *
 * @param {Array} wires - routed wires
 * @param {Map<string, Array<{dir:'h'|'v', coord:number, span:[number,number], end?:string}>>} overrides
 * @returns {Array} wires with matching overrides applied (original array when
 *   nothing matched)
 */
export function applyWireOverrides(wires, overrides) {
  if (!Array.isArray(wires) || !overrides || overrides.size === 0) return wires;

  let changed = false;
  const next = wires.map((wire) => {
    const list = overrides.get(wireOverrideKey(wire));
    if (!Array.isArray(list) || list.length === 0) return wire;

    let points = wire.points;
    let applied = false;
    for (const override of list) {
      if (!override || !Array.isArray(override.span) || override.span.length !== 2) continue;
      const match = matchOverrideSegment(points, override);
      if (!match) continue;
      const shifted = shiftWireSegment(points, match.index, override.coord);
      if (!shifted) continue;
      points = shifted;
      applied = true;
    }

    if (!applied) return wire;
    changed = true;
    return { ...wire, points, isManualRouting: true };
  });

  return changed ? next : wires;
}

/**
 * Apply a visual edit (new centre and/or axis) to a single component,
 * recomputing terminal positions, angle and bounding boxes.
 *
 * @param {Object} comp  - component from the layout
 * @param {{center?:{x,y}, axis?:{x,y}}} edit
 * @param {{width:number, height:number}|null} bounds - canvas size; when
 *   supplied the centre is clamped so the whole component (leads included)
 *   stays inside the canvas
 * @returns {Object} updated component (new object, original untouched)
 */
export function applyEditToComponent(comp, edit, bounds = null) {
  const requested = edit.center ?? comp.center;
  const axis = edit.axis ?? comp.axis;
  const center = bounds
    ? roundPoint(clampCenterToBounds({ ...comp, axis }, requested, bounds))
    : requested;
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
 * Manual `wireOverrides` (from dragging a wire segment) are applied
 * to geometry only, after routing and before label placement and crossing
 * detection. An override that introduces a new validation error is rejected,
 * so a visual edit can never make the drawing claim a connection the circuit
 * does not have.
 *
 * @param {Object} layout  - layout whose components have updated positions
 * @param {Map|null} nodeOverrides - nodeId → {x, y} from junction drags
 * @param {Map|null} wireOverrides - wireOverrideKey → segment descriptors
 * @returns {Object} layout with refreshed wires, junctions, crossings, labels
 */
/**
 * Recompute the state the renderer derives from a layout, so an edited layout
 * is validated and described as edited instead of inheriting the verdict of
 * the layout it was built from.
 *
 * Node membership cannot change here — only geometry is edited — so this is a
 * consistent re-derivation, not a re-solve.
 */
function describeEditedLayout(edited) {
  const renderValidation = validateSchematic(edited);
  const validation = validateGraph({
    nodes: (edited.nodes || []).map((n) => ({ id: n.id, members: n.members || [] })),
    components: edited.components || [],
    connections: Array.isArray(edited.connections) ? edited.connections : [],
  });

  const openNodes = (edited.nodes || []).filter(
    (n) => (n.degree ?? n.members?.length ?? 0) < 2,
  );
  const incomplete = Boolean(edited.incomplete) || openNodes.length > 0;
  const message = incomplete
    ? (edited.message || INCOMPLETE_MESSAGE)
    : edited.isApproximation
      ? (edited.message || APPROX_MESSAGE)
      : null;

  return { ...edited, validation, renderValidation, incomplete, message };
}

export function rerouteLayout(layout, nodeOverrides = null, wireOverrides = null) {
  if (!layout || !layout.ok) return layout;
  const { bounds, nodes } = layout;

  // Clamp before any geometry is derived: a drag can never park a component
  // (and therefore its terminals) outside the canvas.
  const components = (layout.components || []).map((c) => {
    const clamped = roundPoint(clampCenterToBounds(c, c.center, bounds));
    if (clamped.x === c.center.x && clamped.y === c.center.y) return c;
    return applyEditToComponent(c, { center: clamped }, bounds);
  });

  // Anchors the user dragged are never repositioned for layout reasons.
  const locked = new Set(nodeOverrides ? nodeOverrides.keys() : []);

  // Where was every terminal before this edit? A node whose members all stayed
  // put has nothing to re-derive, and rebuilding its position anyway would move
  // geometry the edit never touched.
  const before = new Map();
  for (const comp of layout.components || []) {
    for (const t of comp.terminals || []) {
      before.set(terminalKey(comp.id, t.label), { x: t.x, y: t.y });
    }
  }
  const unchanged = (member) => {
    const was = before.get(member.key);
    return Boolean(was) && was.x === member.point.x && was.y === member.point.y;
  };
  const drawn = new Map((layout.nodes || []).map((n) => [n.id, { x: n.x, y: n.y }]));

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
    // A 3+-member node is a drawn rail anchor and is always derived from its
    // terminals. Nodes below that are not drawn at all — their wire runs
    // terminal to terminal — so their position only carries a label, and it may
    // only move when one of their own terminals moved.
    const isRail = members.length >= 3;
    const settled = drawn.get(node.id);
    const keepDrawn = !isRail && settled && members.every(unchanged);
    plan.set(node.id, {
      id: node.id,
      members,
      degree: members.length,
      isRail,
      // Provenance is re-stated below for dots the image reported and this edit
      // did not move; routing needs it to keep drawing the same junction.
      anchorSource: null,
      point: keepDrawn
        ? roundPoint(settled)
        : (pts.length ? roundPoint(centroid(pts)) : settled ? roundPoint(settled) : { x: 0, y: 0 }),
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

  // An extracted junction dot survives an edit that never moved its members:
  // it is drawn evidence, not a derived centroid.
  const preserved = new Set();
  for (const node of nodes) {
    if (!['extracted-junction', 'routed-conductor'].includes(node.anchorSource) || locked.has(node.id)) continue;
    const entry = plan.get(node.id);
    if (!entry || entry.members.length === 0 || !entry.members.every(unchanged)) continue;
    entry.point = roundPoint({ x: node.x, y: node.y });
    entry.anchorSource = node.anchorSource;
    preserved.add(node.id);
  }

  // The same for a derived anchor the drawing already settled on a branch: while
  // none of its members moved, re-deriving it would only reproduce the point it
  // is on, and any drift would rewrite the wires of a circuit nobody edited.
  const previousEnds = wireTouchesByNode(layout.wires || []);
  for (const node of nodes) {
    const entry = plan.get(node.id);
    if (!entry || !entry.isRail || locked.has(node.id) || preserved.has(node.id)) continue;
    if (entry.members.length === 0 || !entry.members.every(unchanged)) continue;
    const here = (previousEnds.get(node.id) || new Map()).get(drawnKey(node));
    const ownTerminals = entry.members.filter(
      (m) => m.point && drawnKey(m.point) === drawnKey(node),
    ).length;
    if (!isBranchPoint(here, ownTerminals)) continue;
    entry.point = roundPoint({ x: node.x, y: node.y });
    preserved.add(node.id);
  }

  // Keep rail anchors readable after the move: apart from each other, out of
  // component drawings and clear of terminals, so no member wire can collapse.
  // Conflicts on locked anchors are reported after assembly; nothing here
  // repositions a node the user placed or a dot extracted from the image.
  const fixed = new Set([...locked, ...preserved]);
  const lockedConflicts = refineAnchors(plan, components, bounds, locked, preserved);

  // Dots the image drew are evidence that survives an edit; a dot the layout only
  // derived is re-derived from the new drawing instead of being copied forward.
  const junctionEvidence = (layout.junctions || [])
    .filter((j) => j.source === 'extracted')
    .map((j) => ({ nodeId: j.nodeId ?? j.id, point: { x: j.x, y: j.y } }));

  // Assemble a layout around a given set of routed wires. Labels are placed
  // last so they dodge whatever geometry is actually drawn.
  const assemble = (routedWires) => {
    // Node positions are read from the plan *here*, after routing has settled
    // it: the foreign-wire pass below can still move an anchor, and taking the
    // node positions earlier left wires connected to a point no node admitted.
    const updatedNodes = layout.nodes.map((n) => {
      if (plan.has(n.id)) {
        const { point, anchorSource } = plan.get(n.id);
        return { ...n, x: point.x, y: point.y, anchorSource: anchorSource ?? n.anchorSource };
      }
      return n;
    });

    // Copy the components: label placement mutates them, and this layout may
    // be the cached base layout (node-only and wire-only edits must not write
    // into it).
    const placed = components.map((c) => ({ ...c }));
    const junctions = buildJunctions(plan, routedWires, junctionEvidence, placed);
    repositionLabels(placed, routedWires, bounds, updatedNodes, junctions);
    const described = describeEditedLayout({
      ...layout,
      nodes: updatedNodes,
      components: placed,
      wires: routedWires,
      allWires: routedWires,
      junctions,
      crossings: detectCrossings(routedWires, bounds),
    });
    if (lockedConflicts.length === 0) return described;
    // A position the user chose is never corrected for them: surface what the
    // drawing could not reconcile instead of moving the node back. Added to the
    // layout only when it happens, so the unchanged case keeps its old shape.
    return {
      ...described,
      lockedAnchorConflicts: lockedConflicts,
      renderValidation: {
        ...described.renderValidation,
        warnings: [
          ...(described.renderValidation.warnings || []),
          ...lockedConflicts.map((conflict) => conflict.message),
        ],
      },
    };
  };

  // Traced paths whose components an edit did not touch are reused verbatim:
  // the wires keep their identity (and therefore their override keys) instead
  // of being re-routed into a differently-keyed set.
  const termByKey = new Map();
  for (const comp of components) {
    for (const t of comp.terminals || []) {
      termByKey.set(terminalKey(comp.id, t.label), { x: t.x, y: t.y });
    }
  }
  // A rail's drawn trace also stops being valid when the junction dot it runs
  // to was moved, even though every member terminal stayed put.
  const anchorMoved = (w) => {
    if (!w?.node) return false;
    const entry = plan.get(w.node);
    const settled = drawn.get(w.node);
    if (!entry || !settled) return false;
    return entry.point.x !== settled.x || entry.point.y !== settled.y;
  };

  // A traced lead may end on a node's dot instead of on a terminal (that is how
  // a junction drawn in the image is traced), so an anchor is an acceptable
  // endpoint for a pinned trace.
  const anchorPoint = (key) => {
    const name = String(key || '');
    if (!name.startsWith('NODE:')) return null;
    return plan.get(name.slice(5))?.point ?? null;
  };
  const endPoint = (key) => termByKey.get(key) ?? anchorPoint(key);
  const pinnedTraces = (layout.wires || []).filter((w) => {
    if (!w?.isExtracted || !Array.isArray(w.points) || w.points.length < 2) return false;
    const a = endPoint(w.from);
    const b = endPoint(w.to);
    if (!a || !b) return false;
    if (anchorMoved(w)) return false;
    return (
      dist(a, w.points[0]) <= 2 && dist(b, w.points[w.points.length - 1]) <= 2
    );
  });
  // Geometry edits can invalidate a saved trace's coordinates. Preserve its
  // routing style when rebuilding that terminal's lead to the junction.
  const orthogonalLeads = new Set((layout.wires || [])
    .filter((wire) => wire.isExtracted && !pathHasDiagonal(wire.points))
    .flatMap(({ from, to }) => [from, to]));

  const settled = new Set(fixed);
  const routeOptions = () => ({
    orthogonalLeads,
    fixedAnchors: settled,
    lockedAnchors: locked,
    avoidPoints: fixedAnchorPoints(plan, settled),
  });
  let wires = routeWires(components, plan, bounds, [], null, pinnedTraces, routeOptions());
  // A nudged anchor changes the wires that touch it, so re-route briefly until
  // no rail anchor sits on another net's conductor.
  for (let pass = 0; pass < 2; pass += 1) {
    const moved = avoidForeignWireAtAnchors(plan, wires, components, bounds, settled);
    if (moved.size === 0) break;
    for (const id of moved) settled.add(id);
    wires = routeWires(components, plan, bounds, [], null, pinnedTraces, routeOptions());
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const moved = settleAnchorsOnBranches(plan, wires, settled, layout.hasGeometry !== false);
    if (moved.size === 0) break;
    for (const id of moved) settled.add(id);
    wires = routeWires(components, plan, bounds, [], null, pinnedTraces, routeOptions());
  }

  if (!wireOverrides || wireOverrides.size === 0) return assemble(wires);

  const shifted = applyWireOverrides(wires, wireOverrides);
  if (shifted === wires) return assemble(wires);

  const candidate = assemble(shifted);
  const base = assemble(wires);
  const baseErrors = new Set(base.renderValidation.errors);
  // Only NEW errors block the edit: a layout that already had a problem must
  // stay editable.
  const introduced = candidate.renderValidation.errors.filter((e) => !baseErrors.has(e));
  return introduced.length === 0 ? candidate : base;
}

/** Re-exported so callers can keep using a single import surface. */
export { computeNodes, findCycle };
