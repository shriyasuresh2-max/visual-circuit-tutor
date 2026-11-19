/**
 * topologyReconciliation — the confidence-aware topology stage between a
 * recognised image analysis and the electrical graph.
 *
 * The vision model reports four independent kinds of topological evidence:
 *
 *   1. `connections`  — explicit terminal-pair claims (with confidence/status)
 *   2. `wires`        — traced polylines whose two ends name a terminal each
 *   3. `nodes`        — explicit NodeGroup terminal groupings
 *   4. `junctions`    — junction dots listing the terminals that meet at them
 *
 * A junction dot is a picture of one electrical node, so its membership is a
 * node claim exactly like a NodeGroup: each junction contributes a star of edges
 * from its first resolved member (n members → n−1 edges, never n²), and it is
 * judged by the same confidence/status policy as every other claim. Before that
 * was done, a model that reported connectivity only through junction dots (and
 * `nodes: []`) produced a graph of singletons even though its own evidence
 * plainly stated the nets.
 *
 * Historically all three were flattened into one list before union-find ran, so
 * an "uncertain" claim merged two nets exactly like a confirmed one and the
 * evidence that produced it was lost. This module keeps every claim separate,
 * validates it against the terminals that actually exist, merges duplicates
 * without dropping provenance, and classifies the result as confirmed or
 * provisional.
 *
 * ---------------------------------------------------------------------------
 * TERMINAL KEY FORMAT (the single canonical format for this project)
 * ---------------------------------------------------------------------------
 *   `${componentId}.${normalizeLabel(terminalLabel)}`
 *
 * Examples: `R1.B`, `V1.+`, `V1.−` (ASCII '-' and Unicode '−' are one key).
 * `normalizeLabel` / `termKey` are defined here and re-exported by
 * `electricalGraph.js`, so every module keeps using one implementation.
 * Component ids containing a literal '.' are inherently ambiguous in this
 * format; the model is asked for ids like 'R1', and a dotted id would be parsed
 * at its last dot.
 *
 * ---------------------------------------------------------------------------
 * CONFIDENCE / STATUS POLICY (the one place this is decided)
 * ---------------------------------------------------------------------------
 * An edge is *confirmed* (may merge terminals in union-find) unless:
 *
 *   - its merged `status` is 'uncertain', or
 *   - its merged `confidence` is stated and below `provisionalBelowConfidence`
 *     (0.7 — the same threshold `connectionIsUncertain` already used for the
 *     "uncertain connections" note list), or
 *   - it is explicitly marked `confirmed: false`.
 *
 * Everything else is confirmed, including:
 *
 *   - `status: 'probable'` — a positive claim the model judges likely. Only
 *     'uncertain' is withheld from the electrical graph.
 *   - a record with no `status` and no `confidence` — a legacy payload. Absent
 *     confidence is *unstated*, not zero, so all pre-existing analyses keep
 *     their exact topology instead of fragmenting into open terminals.
 * There is no provenance-specific exception: an inferred edge is measured by
 * exactly these thresholds like any other, which is why it is provisional until
 * its connection confidence is raised or a corroboration pass vouches for it.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF CONFIDENCE (never conflated)
 * ---------------------------------------------------------------------------
 *   - *Trace confidence* — `wire.confidence`: how sure the model is that the
 *     visible polyline was followed correctly. It says nothing about whether
 *     the two endpoints are the same electrical node.
 *   - *Connection confidence* — how sure we are that two terminals are joined.
 *     Only this one takes part in the policy above.
 *
 * An inferred edge therefore carries both: `confidence` is the connection-level
 * policy value (`inferredConnectionConfidence`), and `traceConfidence` keeps the
 * wire's own evidence for display and for a later geometric corroboration pass.
 * The trace value is never copied into the connection value.
 *
 * When one edge is claimed by several sources, status is merged pessimistically
 * (any 'uncertain' wins) and connection confidence is the highest *stated*
 * claim-level value. Derived (inferred) confidence is used only when no claim
 * states one, so a wire duplicate can neither promote nor demote a claim, and
 * an unstated explicit confidence stays unstated.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS STAGE DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not corroborate a claim against wire/junction *geometry* (is the
 * traced polyline actually drawn between these terminals?), and it does not
 * change any drawn geometry. It only preserves that evidence: every edge
 * carries the ids of the wires and junction dots that reference its two ends,
 * so a later geometric corroboration pass can consume them without re-reading
 * the analysis.
 */

/* ------------------------------------------------------------------ *
 * Terminal keys
 * ------------------------------------------------------------------ */

/** Canonical minus sign so ASCII '-' and Unicode '−' map to the same terminal. */
export function normalizeLabel(label) {
  if (label == null) return label;
  const s = String(label).trim();
  if (s === '-' || s === '–' || s === '−' || s.toLowerCase() === 'minus' || s.toLowerCase() === 'neg') return '−';
  if (s === '+' || s.toLowerCase() === 'plus' || s.toLowerCase() === 'pos' || s.toLowerCase() === 'positive') return '+';
  return s;
}

/** `${componentId}.${normalizedTerminalLabel}` — the canonical terminal key. */
export function termKey(componentId, terminalLabel) {
  if (componentId == null || terminalLabel == null) return null;
  const label = normalizeLabel(terminalLabel);
  if (label === '') return null;
  return `${componentId}.${label}`;
}

/** Split a canonical key back into component + terminal (last dot wins). */
export function splitTerminalKey(key) {
  if (typeof key !== 'string') return null;
  const dot = key.lastIndexOf('.');
  if (dot <= 0 || dot === key.length - 1) return null;
  return { component: key.slice(0, dot), terminal: normalizeLabel(key.slice(dot + 1)) };
}

/**
 * Normalize a member reference from a Junction or NodeGroup.
 * Accepts the documented `'R1.B'` form; anything else normalizes to null.
 */
export function memberKey(member) {
  if (typeof member !== 'string') return null;
  const split = splitTerminalKey(member.trim());
  return split ? termKey(split.component, split.terminal) : null;
}

/* ------------------------------------------------------------------ *
 * Policy
 * ------------------------------------------------------------------ */

export const CONNECTION_CONFIDENCE_POLICY = Object.freeze({
  /** A stated confidence below this is provisional, never merged. */
  provisionalBelowConfidence: 0.7,
  /** A wire whose *trace* confidence is below this yields no inferred edge. */
  inferredMinWireConfidence: 0.5,
  /**
   * Connection confidence of an inferred edge: how sure we are that the wire's
   * two claimed endpoints are actually one electrical node. Deliberately below
   * `provisionalBelowConfidence` — a correctly traced path is not evidence that
   * its ends are joined — so inferred edges stay provisional and never merge
   * terminals until geometric corroboration exists. Promoting them is a change
   * to this single value, not to any branch in this module.
   */
  inferredConnectionConfidence: 0.6,
});

export const PROVENANCE = Object.freeze({
  EXPLICIT: 'explicit',
  JUNCTION: 'junction',
  INFERRED_WIRE: 'inferred-wire',
  NODE_GROUP: 'node-group',
});

const PROVENANCE_STRENGTH = [
  PROVENANCE.EXPLICIT,
  PROVENANCE.JUNCTION,
  PROVENANCE.NODE_GROUP,
  PROVENANCE.INFERRED_WIRE,
];

const INFERRED_CONNECTION_NOTE =
  'Inferred from a traced wire path — no explicit connection was reported.';

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

/** Read a stated 0–1 confidence, or null when the record does not state one. */
function statedConfidence(record) {
  const raw = record?.confidence;
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Read a detection status, normalized to the three documented levels. */
function statedStatus(record) {
  const raw = record?.status;
  if (raw == null || raw === '') return null;
  const value = String(raw).trim().toLowerCase();
  return value === 'confirmed' || value === 'probable' || value === 'uncertain' ? value : null;
}

/**
 * Normalize either a legacy connection (`from_component`/`from_terminal`) or an
 * already-reconciled edge (`from`/`to` keys, plus component/terminal fields).
 *
 * @returns {{a: string, b: string, fromComponent, fromTerminal, toComponent, toTerminal}|null}
 */
export function connectionEndpoints(record) {
  if (!record || typeof record !== 'object') return null;

  let fromComponent = record.fromComponent ?? null;
  let fromTerminal = record.fromTerminal ?? null;
  let toComponent = record.toComponent ?? null;
  let toTerminal = record.toTerminal ?? null;

  if (fromComponent == null || fromTerminal == null) {
    const split = splitTerminalKey(record.from);
    if (split) {
      fromComponent = fromComponent ?? split.component;
      fromTerminal = fromTerminal ?? split.terminal;
    }
  }
  if (toComponent == null || toTerminal == null) {
    const split = splitTerminalKey(record.to);
    if (split) {
      toComponent = toComponent ?? split.component;
      toTerminal = toTerminal ?? split.terminal;
    }
  }

  if (fromComponent == null) fromComponent = record.from_component ?? null;
  if (fromTerminal == null) fromTerminal = record.from_terminal ?? null;
  if (toComponent == null) toComponent = record.to_component ?? null;
  if (toTerminal == null) toTerminal = record.to_terminal ?? null;

  if (fromComponent == null || toComponent == null) return null;

  const a = termKey(fromComponent, fromTerminal);
  const b = termKey(toComponent, toTerminal);
  if (!a || !b) return null;

  return {
    a,
    b,
    fromComponent,
    fromTerminal: normalizeLabel(fromTerminal),
    toComponent,
    toTerminal: normalizeLabel(toTerminal),
  };
}

/**
 * Decide whether a connection may be merged into an electrical node.
 *
 * Deliberately blind to provenance: an inferred edge is judged by the same
 * thresholds as an explicit claim, so no evidence kind can bypass the policy.
 *
 * @returns {{confirmed: boolean, reason: string}}
 */
export function classifyConnection(record) {
  if (!record || typeof record !== 'object') {
    return { confirmed: false, reason: 'malformed-connection' };
  }
  if (record.confirmed === true) return { confirmed: true, reason: 'marked-confirmed' };
  if (record.confirmed === false) return { confirmed: false, reason: 'marked-provisional' };

  const status = statedStatus(record);
  if (status === 'uncertain') return { confirmed: false, reason: 'status-uncertain' };

  const confidence = statedConfidence(record);
  if (confidence != null && confidence < CONNECTION_CONFIDENCE_POLICY.provisionalBelowConfidence) {
    return { confirmed: false, reason: 'low-confidence' };
  }

  if (status) return { confirmed: true, reason: `status-${status}` };
  if (confidence == null) return { confirmed: true, reason: 'confidence-unstated' };
  return { confirmed: true, reason: 'confidence-stated' };
}

/* ------------------------------------------------------------------ *
 * Merge helpers
 * ------------------------------------------------------------------ */

/** Build full endpoint metadata from two canonical terminal keys. */
function endsFromKeys(a, b) {
  const left = splitTerminalKey(a) || {};
  const right = splitTerminalKey(b) || {};
  return {
    a,
    b,
    fromComponent: left.component ?? null,
    fromTerminal: left.terminal ?? null,
    toComponent: right.component ?? null,
    toTerminal: right.terminal ?? null,
  };
}

function unorderedPair(a, b) {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function uniquePush(list, value) {
  if (value != null && !list.includes(value)) list.push(value);
}

function terminalSets() {
  const parent = new Map();
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(key, root);
    return root;
  };
  const union = (a, b) => {
    const left = find(a);
    const right = find(b);
    if (left !== right) parent.set(right, left);
  };
  return { find, union };
}

function sortProvenance(kinds) {
  return [...kinds].sort(
    (x, y) => PROVENANCE_STRENGTH.indexOf(x) - PROVENANCE_STRENGTH.indexOf(y),
  );
}

function aggregateStatus(sources) {
  const statuses = sources.map(statedStatus).filter(Boolean);
  if (statuses.includes('uncertain')) return 'uncertain';
  if (statuses.includes('confirmed')) return 'confirmed';
  if (statuses.includes('probable')) return 'probable';
  return null;
}

/** The confidence a wire stated for its own trace (evidence, never merged in). */
function statedTraceConfidence(record) {
  return statedConfidence({ confidence: record?.traceConfidence });
}

/**
 * Connection confidence for a merged edge.
 *
 * Claim-level confidence (explicit / node-group) outranks derived confidence
 * (inferred-wire): an inferred duplicate may neither promote a doubtful claim
 * nor demote a confident or unstated one. Derived confidence is consulted only
 * when no claim states a value at all, so an unstated explicit confidence stays
 * unstated instead of inheriting the inferred default.
 */
function aggregateConnectionConfidence(entries) {
  const stated = (predicate) =>
    entries
      .filter((entry) => predicate(entry.kind))
      .map((entry) => statedConfidence(entry.record))
      .filter((value) => value != null);

  // A claim-level record outranks derived confidence even when it states no
  // value: a wire that merely duplicates it may neither promote nor demote it,
  // so an unstated claim stays unstated instead of inheriting the inferred
  // default (which is below the provisional threshold).
  const hasClaim = entries.some((entry) => entry.kind !== PROVENANCE.INFERRED_WIRE);
  const claimed = stated((kind) => kind !== PROVENANCE.INFERRED_WIRE);
  if (hasClaim) return claimed.length ? Math.max(...claimed) : null;

  const derived = stated((kind) => kind === PROVENANCE.INFERRED_WIRE);
  return derived.length ? Math.max(...derived) : null;
}

/** Highest trace confidence among the wires that produced this edge, if any. */
function aggregateTraceConfidence(entries) {
  const values = entries
    .filter((entry) => entry.kind === PROVENANCE.INFERRED_WIRE)
    .map((entry) => statedTraceConfidence(entry.record))
    .filter((value) => value != null);
  return values.length ? Math.max(...values) : null;
}

function aggregateNotes(sources) {
  const notes = [];
  for (const source of sources) {
    const note = typeof source?.notes === 'string' ? source.notes.trim() : '';
    if (note) uniquePush(notes, note);
  }
  return notes.length ? notes.join(' | ') : null;
}

const TERMINAL_CONTACT_TOLERANCE = 1e-6;
const STRONG_EVIDENCE = 0.85;
const pointIsFinite = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function touchesSpan(point, a, b) {
  if (!pointIsFinite(point)) return false;
  const tolerance = TERMINAL_CONTACT_TOLERANCE;
  return point.x >= Math.min(a.x, b.x) - tolerance && point.x <= Math.max(a.x, b.x) + tolerance &&
    point.y >= Math.min(a.y, b.y) - tolerance && point.y <= Math.max(a.y, b.y) + tolerance &&
    Math.abs(cross(a, b, point)) <= tolerance * pointDistance(a, b);
}

function spansTouch(a, b, c, d) {
  return touchesSpan(a, c, d) || touchesSpan(b, c, d) ||
    touchesSpan(c, a, b) || touchesSpan(d, a, b) ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}

function traceSpans(wire) {
  const points = wire.points ?? wire.path;
  if (!Array.isArray(points) || !points.every(pointIsFinite)) return [];
  return points.slice(1).map((point, i) => [points[i], point]);
}

/** A direct, isolated trace can corroborate an already confirmed pair.
 * This never promotes an inferred wire or substitutes layout coordinates. */
function corroboratingTrace(edge, traces, terminalPositions, junctions) {
  const { from, to } = edge;
  if (splitTerminalKey(from)?.component === splitTerminalKey(to)?.component ||
      !edge.claims.some((claim) => claim.kind === PROVENANCE.EXPLICIT &&
        claim.status === 'confirmed' && claim.confidence >= STRONG_EVIDENCE) ||
      junctions.some(({ members }) => members.includes(from) || members.includes(to))) return null;

  const incident = traces.filter(({ ends }) => ends && [ends.a, ends.b].some((key) => key === from || key === to));
  if (incident.length !== 1) return null;
  const [trace] = incident;
  const { wire, ends, spans } = trace;
  if (wire.id == null || unorderedPair(ends.a, ends.b) !== unorderedPair(from, to) ||
      !(statedConfidence(wire) >= STRONG_EVIDENCE) || statedStatus(wire) === 'uncertain' ||
      wire.is_crossing || wire.is_junction || !spans.length ||
      spans.some(([a, b]) => pointDistance(a, b) <= TERMINAL_CONTACT_TOLERANCE)) return null;

  const start = terminalPositions.get(ends.a);
  const finish = terminalPositions.get(ends.b);
  if (!pointIsFinite(start) || !pointIsFinite(finish) ||
      pointDistance(start, spans[0][0]) > TERMINAL_CONTACT_TOLERANCE ||
      pointDistance(finish, spans.at(-1)[1]) > TERMINAL_CONTACT_TOLERANCE) return null;

  const foreignPoints = [...terminalPositions].filter(([key]) => key !== from && key !== to)
    .map(([, point]) => point);
  foreignPoints.push(...junctions.map(({ junction }) => junction.position));
  const foreignSpans = traces.filter((other) => other !== trace).flatMap(({ spans: segments }) => segments);
  if (spans.some(([a, b], i) => foreignPoints.some((point) => touchesSpan(point, a, b)) ||
      foreignSpans.some(([c, d]) => spansTouch(a, b, c, d)) ||
      (i > 0 && (touchesSpan(b, spans[i - 1][0], a) || touchesSpan(spans[i - 1][0], a, b))) ||
      spans.slice(i + 2).some(([c, d]) => spansTouch(a, b, c, d)))) return null;
  return wire;
}

/* ------------------------------------------------------------------ *
 * Reconciliation
 * ------------------------------------------------------------------ */

/**
 * Turn a sanitized analysis into normalized, provenance-carrying edges.
 *
 * @param {Object} sanitizedAnalysis - `validateAnalysis(analysis).analysis`,
 *   with `components` already passed through `ensureTerminals` so the terminal
 *   list it validates against is exactly the one `buildGraph` will use.
 * @returns {{
 *   edges: Array<Object>,
 *   provisional: Array<Object>,
 *   diagnostics: Array<{code: string, severity: string, message: string}>,
 * }}
 */
export function reconcileTopology(sanitizedAnalysis) {
  const analysis = sanitizedAnalysis && typeof sanitizedAnalysis === 'object'
    ? sanitizedAnalysis
    : {};

  const diagnostics = [];
  const addDiagnostic = (code, severity, message, context = {}) => {
    diagnostics.push({ code, severity, message, ...context });
  };

  const components = Array.isArray(analysis.components) ? analysis.components.filter(Boolean) : [];
  const componentIds = new Set();
  const validKeys = new Set();
  for (const component of components) {
    if (component?.id == null) continue;
    componentIds.add(component.id);
    for (const terminal of Array.isArray(component.terminals) ? component.terminals : []) {
      if (!terminal) continue;
      const key = termKey(component.id, terminal.label);
      if (key) validKeys.add(key);
    }
  }

  const connections = Array.isArray(analysis.connections) ? analysis.connections.filter(Boolean) : [];
  const wires = Array.isArray(analysis.wires) ? analysis.wires.filter(Boolean) : [];
  const junctions = Array.isArray(analysis.junctions) ? analysis.junctions.filter(Boolean) : [];
  const nodeGroups = Array.isArray(analysis.nodes) ? analysis.nodes.filter(Boolean) : [];

  /* Junction dots are evidence AND connectivity. Each dot's resolved membership
     is kept (it becomes a node claim below), and the dots that observe each
     terminal are indexed so an edge can carry the ids of the dots at its ends. */
  const junctionIdsByKey = new Map();
  const junctionRecords = [];
  for (const junction of junctions) {
    const junctionId = junction?.id == null ? null : String(junction.id);
    const label = junctionId ?? '(unnamed)';
    const rawMembers = Array.isArray(junction?.members) ? junction.members : [];
    const members = [];
    for (const raw of rawMembers) {
      const key = memberKey(raw);
      if (key && validKeys.has(key)) {
        uniquePush(members, key);
      } else {
        addDiagnostic(
          'junction-member-not-a-terminal',
          'warning',
          `Junction ${label} lists "${raw}", which is not a terminal of any detected component.`,
          { junctionId, key: key ?? String(raw) },
        );
      }
    }
    if (!Array.isArray(junction?.members) || rawMembers.length === 0) {
      addDiagnostic(
        'junction-members-missing',
        'warning',
        `Junction ${label} reports no member list, so it contributes no connectivity.`,
        { junctionId },
      );
    } else if (members.length < 2) {
      addDiagnostic(
        'junction-insufficient-members',
        'info',
        `Junction ${label} resolves ${members.length} terminal(s); a dot needs at least two to join anything.`,
        { junctionId, members },
      );
    }

    junctionRecords.push({ junction, junctionId, members });
    if (junctionId == null) continue;
    for (const key of members) {
      if (!junctionIdsByKey.has(key)) junctionIdsByKey.set(key, []);
      uniquePush(junctionIdsByKey.get(key), junctionId);
    }
  }

  /* Traced wires are evidence too: index them by the terminal pair they join. */
  const wireIdsByPair = new Map();
  for (const wire of wires) {
    const points = wire.points ?? wire.path;
    if (!Array.isArray(points) || !points.slice(1).some((point) =>
      point && points[0] && (point.x !== points[0].x || point.y !== points[0].y))) {
      addDiagnostic('incomplete-wire-trace', 'warning',
        `Wire ${wire.id ?? '(unnamed)'} has no usable conductor span.`, { wireId: wire.id ?? null });
    }
    const ends = connectionEndpoints(wire);
    if (!ends) {
      if (wire.from_component != null || wire.to_component != null || wire.from != null || wire.to != null) {
        addDiagnostic(
          'malformed-wire',
          'warning',
          `Wire ${wire.id ?? '(unnamed)'} does not name a terminal at both ends.`,
          { wireId: wire.id ?? null },
        );
      }
      continue;
    }
    if (ends.a === ends.b) continue;
    const pair = unorderedPair(ends.a, ends.b);
    if (!wireIdsByPair.has(pair)) wireIdsByPair.set(pair, []);
    uniquePush(wireIdsByPair.get(pair), wire.id == null ? null : String(wire.id));
  }

  /* --- claims, in the same order the old pipeline produced them --------- */
  const claims = [];

  for (const connection of connections) {
    const ends = connectionEndpoints(connection);
    if (!ends) {
      addDiagnostic(
        'malformed-connection',
        'error',
        'A reported connection does not name a component and terminal at both ends.',
      );
      continue;
    }
    claims.push({ ends, kind: PROVENANCE.EXPLICIT, origin: connection });
  }

  const explicitEndpoints = new Set();
  for (const claim of claims) {
    explicitEndpoints.add(claim.ends.a);
    explicitEndpoints.add(claim.ends.b);
  }

  const groupRecords = [];
  const memberCountByGroup = new Map();
  const groupsByTerminal = new Map();
  for (const group of nodeGroups) {
    const groupId = group?.id == null ? null : String(group.id);
    const rawMembers = Array.isArray(group?.members) ? group.members : [];
    const members = [];
    for (const raw of rawMembers) {
      const key = memberKey(raw);
      if (key && validKeys.has(key)) uniquePush(members, key);
      else {
        addDiagnostic(
          'node-group-member-not-a-terminal',
          'warning',
          `Node group ${groupId ?? '(unnamed)'} lists "${raw}", which is not a terminal of any detected component.`,
          { nodeGroupId: groupId, key: key ?? String(raw) },
        );
      }
    }
    if (groupId != null && classifyConnection(group).confirmed) {
      memberCountByGroup.set(groupId, (memberCountByGroup.get(groupId) ?? 0) + rawMembers.length);
      for (const key of members) {
        if (!groupsByTerminal.has(key)) groupsByTerminal.set(key, new Set());
        groupsByTerminal.get(key).add(groupId);
      }
    }
    groupRecords.push({ group, members });
  }
  const declaredNode = new Map();
  const contested = new Set();
  const traces = wires.map((wire) => ({ wire, ends: connectionEndpoints(wire), spans: traceSpans(wire) }));
  const terminalPositions = new Map(components.flatMap((component) =>
    (component.terminals ?? []).map((terminal) => [termKey(component.id, terminal.label), terminal.position])));
  for (const [terminal, ids] of groupsByTerminal) {
    if (ids.size === 1) {
      declaredNode.set(terminal, ids.values().next().value);
      continue;
    }

    // An extra singleton may repeat a terminal already on a populated net.
    // Its declaration adds no peer. Keep the populated assignment only when
    // an independent, isolated trace backs an explicit link to a peer that
    // is itself unambiguously assigned to that group.
    const populated = [...ids].filter((id) => memberCountByGroup.get(id) > 1);
    const incident = claims.filter(({ ends }) => ends.a === terminal || ends.b === terminal);
    if (populated.length === 1 && incident.length === 1) {
      const [groupId] = populated;
      const [{ ends, origin }] = incident;
      const peer = ends.a === terminal ? ends.b : ends.a;
      const peerGroups = groupsByTerminal.get(peer);
      if (peerGroups?.size === 1 && peerGroups.has(groupId) && classifyConnection(origin).confirmed) {
        const wire = corroboratingTrace({
          from: terminal, to: peer,
          claims: [{ kind: PROVENANCE.EXPLICIT, status: statedStatus(origin), confidence: statedConfidence(origin) }],
        }, traces, terminalPositions, junctionRecords);
        if (wire) {
          declaredNode.set(terminal, groupId);
          addDiagnostic('redundant-singleton-assignment-resolved', 'info',
            `Terminal ${terminal} belongs to ${groupId} via confirmed connection to ${peer} and isolated trace ${wire.id}; redundant singleton declarations were ignored.`,
            { terminal, peer, nodeGroupId: groupId, wireId: wire.id });
          continue;
        }
      }
    }

    contested.add(terminal);
    addDiagnostic('conflicting-terminal-assignment', 'warning',
      `Terminal ${terminal} is assigned to multiple declared nodes (${[...ids].join(', ')}); those assignments were withheld.`,
      { terminal, nodeGroupIds: [...ids] });
  }
  for (const { group, members: reported } of groupRecords) {
    const members = reported.filter((key) => !contested.has(key));
    // Star from the first member, exactly like the union-find pass it replaces.
    for (let i = 1; i < members.length; i += 1) {
      claims.push({
        ends: endsFromKeys(members[0], members[i]),
        kind: PROVENANCE.NODE_GROUP,
        origin: group,
      });
    }
  }

  /* Where confirmed non-junction evidence already places a terminal, a dot may
     not overwrite that placement: joining two terminals that explicit
     connections (or node groups) have assigned to different nodes would silently
     short a branch, and would merge two confirmed sources that disagree. Record
     those assignments first, so a dot can extend connectivity onto terminals
     nothing else has placed, but can never contradict what was stated outright. */
  const assignedByStronger = new Set(declaredNode.keys());
  const stronger = terminalSets();
  const strongerPairs = new Map();
  for (const claim of claims) {
    const { a, b } = claim.ends;
    if (!validKeys.has(a) || !validKeys.has(b) || a === b) continue;
    const pair = unorderedPair(a, b);
    if (!strongerPairs.has(pair)) strongerPairs.set(pair, { a, b, sources: [] });
    strongerPairs.get(pair).sources.push({ kind: claim.kind, record: claim.origin });
  }
  for (const { a, b, sources } of strongerPairs.values()) {
    const status = aggregateStatus(sources.map(({ record }) => record));
    const confidence = aggregateConnectionConfidence(sources);
    if (!classifyConnection({ status, confidence }).confirmed) continue;
    assignedByStronger.add(a);
    assignedByStronger.add(b);
    stronger.union(a, b);
  }

  // Resolve linked junctions together. Two individually compatible dots can
  // otherwise join distinct nets through a shared unassigned terminal.
  const junctionSets = terminalSets();
  for (const { junction, members } of junctionRecords) {
    if (!classifyConnection(junction).confirmed) continue;
    for (const key of members.slice(1)) junctionSets.union(members[0], key);
  }
  const placementsByCluster = new Map();
  for (const key of assignedByStronger) {
    const cluster = junctionSets.find(key);
    if (!placementsByCluster.has(cluster)) placementsByCluster.set(cluster, []);
    placementsByCluster.get(cluster).push(key);
  }

  /* A junction dot is a picture of one electrical node, so its resolved
     terminals are a node claim — the same shape as a NodeGroup claim, starred
     from the first member so n members add n−1 edges instead of n². The dot's
     own id travels with the claim (it lands on the merged edge as `junctionIds`),
     so its identity stays available for diagnostics and rendering.

     The dot's stated confidence/status decides whether those claims merge: a dot
     that states nothing is *unstated*, not zero, and is confirmed exactly like a
     legacy explicit connection; an 'uncertain' dot or one below the confidence
     threshold stays provisional and merges no terminals. */
  for (const { junction, junctionId, members } of junctionRecords) {
    if (members.length < 2) continue;
    const placed = placementsByCluster.get(junctionSets.find(members[0])) ?? [];
    let groups = [members];
    if (classifyConnection(junction).confirmed && new Set(placed.map(stronger.find)).size > 1) {
      const supported = new Map();
      for (const key of members) {
        if (!assignedByStronger.has(key)) continue;
        const root = stronger.find(key);
        if (!supported.has(root)) supported.set(root, []);
        supported.get(root).push(key);
      }
      groups = [...supported.values()].filter((group) => group.length > 1);
      addDiagnostic(
        'junction-conflicts-with-evidence',
        'warning',
        `Junction ${junctionId ?? '(unnamed)'} groups ${members.join(', ')}. Its junction evidence spans distinct nodes (${placed.join(', ')}); ambiguous assignments were withheld.`,
        { junctionId, members, conflicting: placed, retained: groups },
      );
    }
    for (const group of groups) {
      for (const key of group.slice(1)) {
        claims.push({
          ends: endsFromKeys(group[0], key),
          kind: PROVENANCE.JUNCTION,
          origin: junction,
        });
      }
    }
  }

  /* Conservative wire inference, unchanged in substance from the previous
     recovery pass: only a wire whose BOTH ends are claimed by no explicit
     connection is evidence of a missing one. */
  const covered = new Set(explicitEndpoints);
  for (const wire of wires) {
    const ends = connectionEndpoints(wire);
    if (!ends || ends.a === ends.b) continue;
    if (!componentIds.has(ends.fromComponent) || !componentIds.has(ends.toComponent)) {
      addDiagnostic(
        'unknown-wire-endpoint',
        'warning',
        `Wire ${wire.id ?? '(unnamed)'} refers to a component that was not detected.`,
        { wireId: wire.id ?? null },
      );
      continue;
    }
    if (covered.has(ends.a) || covered.has(ends.b)) continue;
    const wireConfidence = statedConfidence(wire) ?? 1;
    if (wireConfidence < CONNECTION_CONFIDENCE_POLICY.inferredMinWireConfidence) {
      addDiagnostic(
        'wire-too-uncertain-to-infer',
        'info',
        `Wire ${wire.id ?? '(unnamed)'} was traced with confidence ${wireConfidence.toFixed(2)}; no connection was inferred from it.`,
        { wireId: wire.id ?? null },
      );
      continue;
    }
    claims.push({
      ends,
      kind: PROVENANCE.INFERRED_WIRE,
      origin: {
        ...wire,
        // Connection confidence, taken from policy — never the wire's trace
        // confidence, which is preserved separately as `traceConfidence`.
        confidence: CONNECTION_CONFIDENCE_POLICY.inferredConnectionConfidence,
        traceConfidence: wireConfidence,
        notes: INFERRED_CONNECTION_NOTE,
      },
    });
    covered.add(ends.a);
    covered.add(ends.b);
  }

  /* --- validate + merge ------------------------------------------------- */
  const merged = new Map();
  const seenByKind = new Map();

  for (const claim of claims) {
    const { a, b } = claim.ends;
    const missingComponent = [claim.ends.fromComponent, claim.ends.toComponent]
      .filter((id) => !componentIds.has(id));
    if (missingComponent.length) {
      addDiagnostic(
        'unknown-component',
        'error',
        `Connection ${a} → ${b} refers to undetected component(s) ${missingComponent.join(', ')}.`,
        { from: a, to: b, components: missingComponent, provenance: [claim.kind] },
      );
      continue;
    }
    const missingTerminal = [a, b].filter((key) => !validKeys.has(key));
    if (missingTerminal.length) {
      addDiagnostic(
        'unknown-terminal',
        'error',
        `Connection ${a} → ${b} refers to terminal(s) ${missingTerminal.join(', ')} that no detected component declares.`,
        { from: a, to: b, terminals: missingTerminal, provenance: [claim.kind] },
      );
      continue;
    }
    if (a === b) {
      addDiagnostic(
        'self-connection',
        'info',
        `Connection ${a} → ${b} joins a terminal to itself and was ignored.`,
        { terminal: a, provenance: [claim.kind] },
      );
      continue;
    }

    const pair = unorderedPair(a, b);
    const kindSeen = `${claim.kind}|${pair}`;
    if (seenByKind.has(kindSeen)) {
      addDiagnostic(
        'duplicate-connection',
        'info',
        `The ${claim.kind} evidence claims ${a} → ${b} more than once; the claims were merged.`,
        { from: a, to: b, provenance: [claim.kind] },
      );
    } else {
      seenByKind.set(kindSeen, true);
    }

    let entry = merged.get(pair);
    if (!entry) {
      entry = {
        from: a,
        to: b,
        fromComponent: claim.ends.fromComponent,
        fromTerminal: claim.ends.fromTerminal,
        toComponent: claim.ends.toComponent,
        toTerminal: claim.ends.toTerminal,
        provenance: [],
        sources: [],
        wireIds: [],
        junctionIds: [],
      };
      merged.set(pair, entry);
    }
    uniquePush(entry.provenance, claim.kind);
    entry.sources.push({ kind: claim.kind, record: claim.origin });
    for (const id of wireIdsByPair.get(pair) || []) uniquePush(entry.wireIds, id);
    for (const id of junctionIdsByKey.get(a) || []) {
      if ((junctionIdsByKey.get(b) || []).includes(id)) uniquePush(entry.junctionIds, id);
    }
  }

  /* --- finalize --------------------------------------------------------- */
  const edges = [];
  for (const entry of merged.values()) {
    const sources = entry.sources.map((source) => source.record);
    const status = aggregateStatus(sources);
    const confidence = aggregateConnectionConfidence(entry.sources);
    const traceConfidence = aggregateTraceConfidence(entry.sources);
    const notes = aggregateNotes(sources);
    const provenance = sortProvenance(entry.provenance);

    const edge = {
      from: entry.from,
      to: entry.to,
      fromComponent: entry.fromComponent,
      fromTerminal: entry.fromTerminal,
      toComponent: entry.toComponent,
      toTerminal: entry.toTerminal,
      // Legacy field names, so existing consumers/tests keep working.
      from_component: entry.fromComponent,
      from_terminal: entry.fromTerminal,
      to_component: entry.toComponent,
      to_terminal: entry.toTerminal,
      provenance,
      // Connection confidence: the only value the policy decides on.
      confidence,
      status,
      notes,
      // How sure the vision model was of the wire paths behind this edge. Kept
      // apart from `confidence` so trace quality is never read as electrical
      // certainty (null for edges no wire contributed to).
      traceConfidence,
      wireIds: entry.wireIds,
      junctionIds: entry.junctionIds,
      sources: entry.sources.map((source) => source.kind),
      // One lightweight entry per merged claim, so collapsing duplicates loses
      // no evidence (polyline geometry stays on the graph's wires).
      claims: entry.sources.map((source) => ({
        kind: source.kind,
        id: source.record?.id ?? null,
        confidence: statedConfidence(source.record),
        status: statedStatus(source.record),
        traceConfidence:
          source.kind === PROVENANCE.INFERRED_WIRE
            ? statedTraceConfidence(source.record)
            : null,
      })),
    };

    const verdict = classifyConnection(edge);
    edge.confirmed = verdict.confirmed;
    edge.reason = verdict.reason;
    edges.push(edge);

    const statuses = sources.map(statedStatus).filter(Boolean);
    if (statuses.includes('uncertain') && statuses.includes('confirmed')) {
      addDiagnostic(
        'conflicting-evidence',
        'warning',
        `${edge.from} → ${edge.to} is reported as both confirmed and uncertain; it is treated as provisional.`,
        { from: edge.from, to: edge.to, provenance },
      );
    }
    for (const source of sources) {
      const sourceStatus = statedStatus(source);
      const sourceConfidence = statedConfidence(source);
      if (
        sourceStatus === 'confirmed' &&
        sourceConfidence != null &&
        sourceConfidence < CONNECTION_CONFIDENCE_POLICY.provisionalBelowConfidence
      ) {
        addDiagnostic(
          'status-confidence-conflict',
          'warning',
          `${edge.from} → ${edge.to} is labelled confirmed with confidence ${sourceConfidence.toFixed(2)}; confidence decides.`,
          { from: edge.from, to: edge.to, confidence: sourceConfidence },
        );
      }
    }
  }

  /* Report dots whose members the confirmed edges still do not join. Now that a
     dot contributes its own claims, this no longer fires merely because its
     membership was ignored: it means either that the dot's own evidence was
     withheld by the confidence policy, or that confirmed evidence from an
     independent source puts its members on different nodes. */
  // An unassigned region may attach to one declared node. If it borders
  // multiple declared nodes, preserve its internal evidence and withhold all
  // competing attachments. This avoids picking a net based on input order.
  const unassigned = terminalSets();
  const regions = new Map();
  for (const { from, to, confirmed } of edges) {
    if (confirmed && !declaredNode.has(from) && !declaredNode.has(to)) unassigned.union(from, to);
  }
  for (const { from, to, confirmed } of edges) {
    if (!confirmed || declaredNode.has(from) === declaredNode.has(to)) continue;
    const [known, unknown] = declaredNode.has(from) ? [from, to] : [to, from];
    const root = unassigned.find(unknown);
    if (!regions.has(root)) regions.set(root, new Set());
    regions.get(root).add(declaredNode.get(known));
  }
  const edgeCountByTerminal = new Map();
  for (const { from, to } of edges) {
    for (const key of [from, to]) edgeCountByTerminal.set(key, (edgeCountByTerminal.get(key) ?? 0) + 1);
  }
  for (const edge of edges) {
    if (!edge.confirmed) continue;
    const fromNode = declaredNode.get(edge.from);
    const toNode = declaredNode.get(edge.to);
    if (fromNode == null && toNode == null) continue;
    const candidates = fromNode != null && toNode != null
      ? new Set([fromNode, toNode])
      : regions.get(unassigned.find(fromNode == null ? edge.from : edge.to));
    if (!candidates || candidates.size < 2) continue;
    // A split between two lone, uncontested terminals can be a redundant
    // declaration of the endpoints of one wire. Keep the confirmed edge only
    // when there are no competing attachments and its own trace verifies it.
    if (memberCountByGroup.get(fromNode) === 1 && memberCountByGroup.get(toNode) === 1 &&
        edgeCountByTerminal.get(edge.from) === 1 && edgeCountByTerminal.get(edge.to) === 1) {
      const wire = corroboratingTrace(edge, traces, terminalPositions, junctionRecords);
      if (wire) {
        addDiagnostic('singleton-declarations-resolved', 'info',
          `Confirmed connection ${edge.from} to ${edge.to} is corroborated by isolated trace ${wire.id}; the two singleton declarations describe one conductor.`,
          { from: edge.from, to: edge.to, wireId: wire.id, nodeGroupIds: [fromNode, toNode] });
        continue;
      }
    }
    edge.confirmed = false;
    edge.reason = 'declared-node-conflict';
    addDiagnostic('declared-node-conflict', 'warning',
      `Connection evidence for ${edge.from} and ${edge.to} was withheld because it would join distinct declared nodes (${[...candidates].join(', ')}).`,
      { from: edge.from, to: edge.to, nodeGroupIds: [...candidates], provenance: edge.provenance });
  }
  const confirmedEdges = edges.filter((edge) => edge.confirmed);
  if (junctionRecords.length) {
    const { find, union } = terminalSets();
    for (const edge of confirmedEdges) union(edge.from, edge.to);
    for (const { junctionId, members } of junctionRecords) {
      if (members.length < 2) continue;
      const roots = new Set(members.map(find));
      if (roots.size < 2) continue;
      // Did this dot's own claims survive the confidence policy?
      const own = edges.filter((edge) =>
        (edge.claims || []).some(
          (claim) => claim.kind === PROVENANCE.JUNCTION
            && (junctionId == null || claim.id === junctionId),
        ));
      const withheld = own.filter((edge) => !edge.confirmed).length > 0;
      addDiagnostic(
        'junction-members-split',
        'warning',
        withheld
          ? `Junction ${junctionId ?? '(unnamed)'} groups ${members.join(', ')} but its evidence is provisional, so those terminals are not merged.`
          : `Confirmed evidence puts the members of junction ${junctionId ?? '(unnamed)'} (${members.join(', ')}) on different nodes; the dot and the connections disagree.`,
        { junctionId, members, provisional: withheld },
      );
    }
  }

  const provisional = edges.filter((edge) => !edge.confirmed);
  return { edges, provisional, diagnostics };
}
