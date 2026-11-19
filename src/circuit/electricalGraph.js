/**
 * electricalGraph — builds a canonical electrical graph from a circuit
 * analysis response. The graph is independent of the SVG renderer and is
 * suitable for future circuit solving, simulation, and animation.
 *
 * The graph captures:
 *   - Components with their terminals mapped to electrical nodes
 *   - Electrical nodes (groups of connected terminals)
 *   - Wires as geometric paths between terminals/nodes
 *   - Junctions (where 3+ connections meet)
 *   - Crossings (wires that cross without connecting)
 *   - Confidence and uncertainty for every detection
 *   - Geometry (normalised coordinates) when available from the analysis
 *
 * buildGraph() is the main entry point. validateGraph() checks integrity.
 */

import {
  PROVENANCE,
  classifyConnection,
  connectionEndpoints,
  memberKey,
  normalizeLabel,
  reconcileTopology,
  splitTerminalKey,
  termKey,
} from './topologyReconciliation.js';
import { parseDcValue } from './electricalValue.js';

/* ------------------------------------------------------------------ *
 * Union-Find (shared with circuitLayout.js — kept here for independence)
 * ------------------------------------------------------------------ */
class UnionFind {
  constructor() {
    this.parent = {};
  }
  find(x) {
    if (this.parent[x] === undefined) this.parent[x] = x;
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

const SOURCE_TYPES = new Set(['battery', 'voltage_source', 'ac_voltage_source', 'current_source']);
const PASSIVE_TYPES = new Set(['resistor', 'capacitor', 'inductor', 'diode', 'led', 'switch', 'ammeter', 'voltmeter']);

// Export helpers for circuitLayout.js. `termKey`/`normalizeLabel` are defined in
// topologyReconciliation.js (the module that owns the terminal-key format) and
// re-exported here so existing imports keep working unchanged.
export { SOURCE_TYPES, PASSIVE_TYPES, termKey, polarityOf, ensureTerminals, normalizeLabel };

function polarityOf(label) {
  if (!label) return null;
  const l = String(label).trim().toLowerCase();
  if (['+', 'plus', 'positive', 'pos'].includes(l)) return '+';
  if (['−', '-', '–', 'minus', 'negative', 'neg', '_'].includes(l)) return '-';
  return null;
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

function sanitizePoint(p) {
  if (!p || typeof p !== 'object') return null;
  const x = clamp01(p.x);
  const y = clamp01(p.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function ensureTerminals(components) {
  return components.map((c) => {
    const terms = Array.isArray(c.terminals) && c.terminals.length >= 2
      ? c.terminals
      : [{ label: 'A', description: null, position: null }, { label: 'B', description: null, position: null }];
    return {
      ...c,
      terminals: terms.map((t) => ({
        label: normalizeLabel(t.label ?? 'A'),
        description: t.description ?? null,
        position: sanitizePoint(t.position),
      })),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Node computation
 * ------------------------------------------------------------------ */

/**
 * Compute electrical nodes from components + connections + explicit node groups.
 * Uses union-find: connections merge terminals, explicit node groups also merge.
 *
 * Two rules keep the result trustworthy:
 *   - only terminals that a detected component actually declares can become
 *     node members (a claim naming a phantom terminal is dropped, not drawn);
 *   - a claim the confidence policy classifies as provisional is NOT unioned,
 *     so an uncertain junction/crossing can never silently merge two nets.
 *
 * @returns {{
 *   nodeOf: Map<string,string>,
 *   nodes: Array<{id,members}>,
 *   ignored: Array<{reason: string, key: string|null}>,
 * }}
 */
export function computeNodes(components, connections, explicitNodes = []) {
  const comps = ensureTerminals(components);
  const uf = new UnionFind();

  // The only keys that may ever become node members.
  const validKeys = new Set();
  for (const c of comps) {
    for (const t of c.terminals) {
      const key = termKey(c.id, t.label);
      if (key) validKeys.add(key);
    }
  }
  for (const key of validKeys) uf.find(key);

  const ignored = [];
  const list = Array.isArray(connections) ? connections : [];

  // Merge via connections — never invent extra unions from proximity or
  // crossings, and never merge a provisional claim.
  for (const conn of list) {
    if (!conn) continue;
    const ends = connectionEndpoints(conn);
    if (!ends) {
      ignored.push({ reason: 'malformed-connection', key: null });
      continue;
    }
    const missing = [ends.a, ends.b].filter((key) => !validKeys.has(key));
    if (missing.length) {
      ignored.push({ reason: 'unknown-terminal', key: missing[0] });
      continue;
    }
    if (ends.a === ends.b) continue;
    if (!classifyConnection(conn).confirmed) continue;
    uf.union(ends.a, ends.b);
  }

  // Merge via explicit node groups, validated against the same terminal set.
  for (const ng of Array.isArray(explicitNodes) ? explicitNodes : []) {
    if (!ng || !Array.isArray(ng.members) || ng.members.length < 2) continue;
    const keys = [];
    for (const member of ng.members) {
      const key = memberKey(member);
      if (!key) continue;
      if (!validKeys.has(key)) {
        ignored.push({ reason: 'unknown-terminal', key });
        continue;
      }
      if (!keys.includes(key)) keys.push(key);
    }
    for (let i = 1; i < keys.length; i += 1) uf.union(keys[0], keys[i]);
  }

  // Group by root in component/terminal order (stable node numbering).
  const groups = new Map();
  const nodeOf = new Map();
  for (const key of validKeys) {
    const root = uf.find(key);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(key);
  }

  const nodes = [];
  let idx = 0;
  for (const [, members] of groups) {
    const id = `N${idx}`;
    idx += 1;
    nodes.push({ id, members: [...members] });
    for (const m of members) nodeOf.set(m, id);
  }

  return { nodeOf, nodes, ignored };
}

/* ------------------------------------------------------------------ *
 * Adjacency graph and cycle detection
 * ------------------------------------------------------------------ */

function buildAdjacency(components, nodeOf) {
  const comps = ensureTerminals(components);
  const adj = new Map();
  for (const c of comps) {
    const [t0, t1] = c.terminals;
    const n0 = nodeOf.get(termKey(c.id, t0.label));
    const n1 = nodeOf.get(termKey(c.id, t1.label));
    if (n0 != null) {
      if (!adj.has(n0)) adj.set(n0, []);
      adj.get(n0).push({ compId: c.id, otherNode: n1 });
    }
    if (n1 != null && n1 !== n0) {
      if (!adj.has(n1)) adj.set(n1, []);
      adj.get(n1).push({ compId: c.id, otherNode: n0 });
    }
  }
  return adj;
}

/**
 * Find a cycle in the node graph via DFS.
 * Uses edge-based (component-id) parent tracking so parallel edges
 * between the same two nodes are correctly recognised as a cycle.
 *
 * @returns {string[]|null} ordered list of node ids forming the cycle
 */
export function findCycle(components, nodeOf) {
  const adj = buildAdjacency(components, nodeOf);
  if (adj.size === 0) return null;

  const comps = ensureTerminals(components);
  const starts = [];
  for (const c of comps) {
    if (SOURCE_TYPES.has(c.type)) {
      const n0 = nodeOf.get(termKey(c.id, c.terminals[0].label));
      if (n0 != null) starts.push(n0);
    }
  }
  for (const n of adj.keys()) {
    if (!starts.includes(n)) starts.push(n);
  }

  const visited = new Set();
  const stack = [];
  const stackSet = new Set();
  let found = null;

  function dfs(u, parentEdge) {
    if (found) return;
    stack.push(u);
    stackSet.add(u);
    visited.add(u);
    for (const { compId, otherNode: v } of (adj.get(u) || [])) {
      if (found) return;
      if (v == null) continue;
      if (compId === parentEdge) continue;
      if (stackSet.has(v)) {
        found = stack.slice(stack.indexOf(v));
        return;
      }
      if (!visited.has(v)) dfs(v, compId);
    }
    if (found) return;
    stack.pop();
    stackSet.delete(u);
  }

  for (const startNode of starts) {
    if (found) break;
    if (!visited.has(startNode)) dfs(startNode, null);
  }
  return found;
}

/**
 * Split a drawn value into its number and its unit, and say whether the unit is
 * one a schematic legitimately carries.
 *
 * Extraction routinely mis-reads a unit glyph ("Ω" comes back as a Greek
 * alpha). Guessing the intended unit from the component id or type would put a
 * claim in the drawing that the image never made, so an unreadable unit is
 * dropped and reported instead: the number survives, the unit is marked as not
 * recognised.
 */
const KNOWN_UNITS = new Set([
  'Ω', 'Ω', 'ohm', 'ohms',
  'V', 'mV', 'kV', 'µV', 'uV',
  'A', 'mA', 'µA', 'uA', 'kA',
  'F', 'mF', 'µF', 'uF', 'nF', 'pF',
  'H', 'mH', 'µH', 'uH',
  'W', 'kW', 'mW', 'MW',
  'J', 'kJ', 'C', 'S', 'VA', 'VAR', 'Ah', 'Wh',
  'Hz', 'kHz', 'MHz', 'GHz', '%',
]);

export function splitValue(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { value: null, unit: null, unitRecognized: true, rawUnit: null };
  const match = text.match(/^([-+]?\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match || !match[2]) {
    return { value: text, unit: match ? null : null, unitRecognized: true, rawUnit: null };
  }
  const number = match[1];
  const unit = match[2].trim();
  if (KNOWN_UNITS.has(unit)) return { value: text, unit, unitRecognized: true, rawUnit: unit };
  // Only a single stray glyph is treated as a mis-read unit. Anything longer is
  // left exactly as extracted: it may be a unit this list does not know, and
  // rewriting it would be its own kind of invention.
  const isStrayGlyph = [...unit].length === 1 && /[^\x20-\x7E]/.test(unit);
  if (isStrayGlyph) return { value: number, unit: null, unitRecognized: false, rawUnit: unit };
  return { value: text, unit: null, unitRecognized: true, rawUnit: null };
}

/* ------------------------------------------------------------------ *
 * Main entry: build canonical graph
 * ------------------------------------------------------------------ */

/**
 * Build a canonical electrical graph from a circuit analysis response.
 *
 * @param {Object} analysis - backend CircuitAnalysis object
 * @returns {Object} canonical graph
 */
export function buildGraph(analysis) {
  const { analysis: sanitized } = validateAnalysis(analysis);
  const wires = sanitized.wires;
  const junctions = sanitized.junctions;

  // Reconcile every topological claim first: references are validated against
  // exactly the terminals this graph uses, duplicates merge with their
  // provenance kept, and uncertain claims are withheld from union-find.
  const comps = ensureTerminals(sanitized.components);
  const topology = reconcileTopology({ ...sanitized, components: comps });
  const { nodeOf, nodes, ignored } = computeNodes(comps, topology.edges, []);

  // Check if geometry is available
  const hasComponentGeometry = comps.some((c) => c.center || c.bbox);
  const hasTerminalGeometry = comps.some((c) => c.terminals?.some((t) => t.position));
  const hasWireGeometry = wires.some((w) => w.points && w.points.length >= 2);
  const hasGeometry = hasComponentGeometry || hasTerminalGeometry || hasWireGeometry;

  // Build component entries with terminal → node mapping
  const graphComponents = comps.map((c) => {
    const [t0, t1] = c.terminals;
    const na = nodeOf.get(termKey(c.id, t0.label));
    const nb = nodeOf.get(termKey(c.id, t1.label));

    let posTerminal = null;
    if (SOURCE_TYPES.has(c.type)) {
      if (polarityOf(t0.label) === '+') posTerminal = 'A';
      else if (polarityOf(t1.label) === '+') posTerminal = 'B';
    }

    const bbox = c.bbox
      ? {
          x: c.bbox.x,
          y: c.bbox.y,
          width: c.bbox.width,
          height: c.bbox.height,
        }
      : null;

    const parsedValue = parseDcValue(c);
    const drawn = parsedValue ? {
      value: parsedValue.text,
      unit: parsedValue.unit,
      rawUnit: parsedValue.rawUnit,
      unitRecognized: parsedValue.status !== 'invalid-unit',
    } : splitValue(c.visible_value);
    return {
      id: c.id,
      type: c.type,
      value: drawn.value,
      // What the image said, and whether its unit could be read at all. Kept so
      // a caller can show the raw text without presenting a wrong unit as fact.
      valueRaw: c.visible_value ?? null,
      valueUnit: drawn.unit,
      valueUnitRecognized: drawn.unitRecognized,
      valueUnitRaw: drawn.rawUnit,
      confidence: c.confidence ?? 1,
      status: c.status ?? (c.confidence >= 0.85 ? 'confirmed' : c.confidence >= 0.6 ? 'probable' : 'uncertain'),
      notes: c.notes ?? null,
      center: c.center ?? null,
      bbox,
      width: bbox?.width ?? null,
      height: bbox?.height ?? null,
      orientation: c.orientation ?? null,
      posTerminal,
      terminals: c.terminals.map((t) => ({
        label: t.label,
        node: nodeOf.get(termKey(c.id, t.label)) ?? null,
        position: t.position ?? null,
      })),
    };
  });

  // Build wire entries — keep `points` as the canonical geometry field
  const graphWires = wires.map((w) => {
    const points = (w.points || w.path || [])
      .map((p) => sanitizePoint(p) || (p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null))
      .filter(Boolean);
    return {
      id: w.id,
      points,
      path: points,
      from: `${w.from_component}.${normalizeLabel(w.from_terminal)}`,
      to: `${w.to_component}.${normalizeLabel(w.to_terminal)}`,
      isCrossing: w.is_crossing ?? false,
      isJunction: w.is_junction ?? false,
      confidence: w.confidence ?? 1,
    };
  });

  // Build junction entries (distinguishing true 3+ junctions from bends/terminals)
  const graphJunctions = junctions.map((j) => {
    // Membership is model output: keep only usable references, so one malformed
    // entry cannot break the whole graph.
    const rawMembers = Array.isArray(j?.members) ? j.members : [];
    const normMembers = rawMembers
      .filter((m) => typeof m === 'string' && m.trim() !== '')
      .map((m) => {
        const split = splitTerminalKey(m.trim());
        return split ? termKey(split.component, split.terminal) : m.trim();
      });
    const nodeAtPos = nodes.find((n) => n.members.some((m) => normMembers.includes(m)));
    const isRealJunction = normMembers.length >= 3 || (nodeAtPos && nodeAtPos.members.length >= 3);
    return {
      id: j.id,
      position: j.position ?? null,
      members: normMembers,
      isRealJunction,
    };
  });

  // Collect crossings from wire flags
  const crossings = graphWires.filter((w) => w.isCrossing).map((w) => ({
    id: `X-${w.id}`,
    wireId: w.id,
    confidence: w.confidence,
  }));

  // `connections` means "image-reported electrical connections": an explicit
  // claim, a junction dot's own node claim, or a claim derived from a traced
  // wire. NodeGroup-only edges are grouping evidence and are exposed through
  // `topology.edges` instead.
  const isReported = (edge) =>
    edge.provenance.includes(PROVENANCE.EXPLICIT) ||
    edge.provenance.includes(PROVENANCE.JUNCTION) ||
    edge.provenance.includes(PROVENANCE.INFERRED_WIRE);
  const confirmedConnections = topology.edges.filter((edge) => edge.confirmed && isReported(edge));
  const provisional = topology.edges.filter((edge) => !edge.confirmed);

  const diagnostics = [...topology.diagnostics];
  for (const wire of graphWires) {
    const fromNode = nodeOf.get(wire.from);
    const toNode = nodeOf.get(wire.to);
    if (fromNode == null || toNode == null || fromNode === toNode) continue;
    diagnostics.push({
      code: 'wire-trace-node-disagreement',
      severity: 'warning',
      message: `Wire ${wire.id ?? '(unnamed)'} claims a path from ${wire.from} (${fromNode}) to ${wire.to} (${toNode}); its endpoints are on different reconstructed nodes.`,
      wireId: wire.id ?? null,
      from: wire.from,
      to: wire.to,
    });
  }
  for (const c of graphComponents) {
    if (c.valueUnitRecognized === false) {
      diagnostics.push({
        code: 'value-unit-unreadable',
        severity: 'warning',
        message: `${c.id}: the unit "${c.valueUnitRaw}" is not a recognised unit, so it is not drawn.`,
        componentId: c.id,
        rawUnit: c.valueUnitRaw,
      });
    }
  }
  for (const entry of ignored) {
    diagnostics.push({
      code: 'dropped-connection',
      severity: 'warning',
      message: `A connection could not be reconciled (${entry.reason}${entry.key ? `: ${entry.key}` : ''}).`,
      key: entry.key ?? null,
    });
  }

  // Structural validation deliberately keeps reading the raw claims, so a
  // reference to an unknown component is still reported as a graph error.
  const validation = validateGraph({
    nodes,
    components: graphComponents,
    wires: graphWires,
    junctions: graphJunctions,
    crossings,
    connections: sanitized.connections,
  });
  const unresolvedTopology = new Set([
    'conflicting-terminal-assignment', 'declared-node-conflict',
    'junction-conflicts-with-evidence', 'junction-members-split',
    'wire-trace-node-disagreement',
  ]);
  for (const diagnostic of diagnostics) {
    if (unresolvedTopology.has(diagnostic.code) || diagnostic.code === 'incomplete-wire-trace') {
      validation.warnings.push(diagnostic.message);
    }
  }

  return {
    nodes,
    components: graphComponents,
    // Recognised wire/junction evidence stays on the graph: geometry, ids,
    // confidence and flags are preserved for later corroboration.
    wires: graphWires,
    junctions: graphJunctions,
    crossings,
    connections: confirmedConnections,
    provisional,
    diagnostics,
    topology: { edges: topology.edges, provisional, diagnostics },
    validation,
    hasGeometry,
    incomplete:
      Boolean(sanitized.reconstruction_incomplete) ||
      provisional.length > 0 ||
      diagnostics.some((diagnostic) => unresolvedTopology.has(diagnostic.code)) ||
      hasOpenTerminals(nodes) ||
      !validation.isValid,
    reconstruction_incomplete: Boolean(sanitized.reconstruction_incomplete),
  };
}

function hasOpenTerminals(nodes) {
  return nodes.some((n) => n.members.length === 1);
}

/**
 * Sanitize extracted analysis without inventing components or connections.
 * Drops null entries, clamps coordinates to [0,1], and normalizes polarity labels.
 */
export function validateAnalysis(analysis) {
  const errors = [];
  const warnings = [];
  if (!analysis || typeof analysis !== 'object') {
    return {
      analysis: {
        components: [],
        connections: [],
        wires: [],
        junctions: [],
        nodes: [],
        reconstruction_incomplete: true,
      },
      errors: ['Missing analysis payload'],
      warnings,
      isValid: false,
    };
  }

  const components = (Array.isArray(analysis.components) ? analysis.components : [])
    .filter(Boolean)
    .map((c) => {
      const center = sanitizePoint(c.center);
      let bbox = null;
      if (c.bbox && typeof c.bbox === 'object') {
        const x = clamp01(c.bbox.x);
        const y = clamp01(c.bbox.y);
        const width = clamp01(c.bbox.width);
        const height = clamp01(c.bbox.height);
        if (x != null && y != null && width != null && height != null) {
          bbox = { x, y, width, height };
        }
      }
      return {
        ...c,
        center,
        bbox,
        terminals: Array.isArray(c.terminals)
          ? c.terminals.filter(Boolean).map((t) => ({
              ...t,
              label: normalizeLabel(t.label ?? 'A'),
              position: sanitizePoint(t.position),
            }))
          : [],
      };
    });

  const connections = (Array.isArray(analysis.connections) ? analysis.connections : [])
    .filter(Boolean)
    .map((conn) => ({
      ...conn,
      from_terminal: normalizeLabel(conn.from_terminal),
      to_terminal: normalizeLabel(conn.to_terminal),
    }));

  const wires = (Array.isArray(analysis.wires) ? analysis.wires : [])
    .filter(Boolean)
    .map((w) => ({
      ...w,
      from_terminal: normalizeLabel(w.from_terminal),
      to_terminal: normalizeLabel(w.to_terminal),
      points: (Array.isArray(w.points) ? w.points : Array.isArray(w.path) ? w.path : [])
        .map(sanitizePoint).filter(Boolean),
    }));

  const junctions = (Array.isArray(analysis.junctions) ? analysis.junctions : [])
    .filter(Boolean)
    .map((j) => ({
      ...j,
      position: sanitizePoint(j.position),
      members: Array.isArray(j.members) ? j.members : [],
    }));

  const nodes = Array.isArray(analysis.nodes) ? analysis.nodes.filter(Boolean) : [];

  if (components.length === 0) errors.push('No components detected');

  return {
    analysis: {
      ...analysis,
      components,
      connections,
      wires,
      junctions,
      nodes,
      reconstruction_incomplete: Boolean(analysis.reconstruction_incomplete),
    },
    errors,
    warnings,
    isValid: errors.length === 0,
  };
}

/* ------------------------------------------------------------------ *
 * Graph validation
 * ------------------------------------------------------------------ */

/**
 * Validate the canonical graph for integrity.
 * Checks that every component has terminals, every connection has valid
 * endpoints, no terminal is orphaned without a node, and no extra connections
 * were generated.
 *
 * @returns {{ isValid, errors: [], warnings: [] }}
 */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  const { nodes, components, connections } = graph;

  const componentIds = new Set(components.map((c) => c.id));
  const terminalKeys = new Set();
  const nodeByTerminal = new Map();
  for (const node of nodes) {
    for (const key of node.members) nodeByTerminal.set(key, node.id);
  }
  for (const c of components) {
    for (const t of c.terminals) {
      terminalKeys.add(`${c.id}.${t.label}`);
    }
  }

  // Check: every component has at least 2 terminals
  for (const c of components) {
    if (!c.terminals || c.terminals.length < 2) {
      warnings.push(`Component ${c.id} has fewer than 2 terminals`);
    }
    // Check: every terminal has a node
    for (const t of c.terminals) {
      if (!t.node) {
        warnings.push(`Terminal ${c.id}.${t.label} has no electrical node assignment`);
      }
    }
  }

  // Check: every connection references valid components and terminals
  if (Array.isArray(connections)) {
    for (const conn of connections) {
      if (!conn) continue;
      const fromKey = `${conn.from_component}.${normalizeLabel(conn.from_terminal)}`;
      const toKey = `${conn.to_component}.${normalizeLabel(conn.to_terminal)}`;
      if (!componentIds.has(conn.from_component)) {
        errors.push(`Connection references unknown component: ${conn.from_component}`);
      }
      if (!componentIds.has(conn.to_component)) {
        errors.push(`Connection references unknown component: ${conn.to_component}`);
      }
      if (!terminalKeys.has(fromKey)) {
        warnings.push(`Connection references unknown terminal: ${fromKey}`);
      }
      if (!terminalKeys.has(toKey)) {
        warnings.push(`Connection references unknown terminal: ${toKey}`);
      }
      if (classifyConnection(conn).confirmed && nodeByTerminal.has(fromKey) &&
          nodeByTerminal.has(toKey) && nodeByTerminal.get(fromKey) !== nodeByTerminal.get(toKey)) {
        warnings.push(`Reported connection ${fromKey} to ${toKey} is split across reconstructed nodes ${nodeByTerminal.get(fromKey)} and ${nodeByTerminal.get(toKey)}.`);
      }
    }
  }

  // Check: no node has only one member (orphan terminal)
  for (const n of nodes) {
    if (n.members.length === 1) {
      warnings.push(`Node ${n.id} has only one member: ${n.members[0]} (possible orphan)`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Topology helpers
 * ------------------------------------------------------------------ */

/**
 * Check if two terminals are in the same electrical node.
 */
export function sameNode(graph, compA, termA, compB, termB) {
  const a = graph.components.find((c) => c.id === compA);
  const b = graph.components.find((c) => c.id === compB);
  if (!a || !b) return false;
  const ta = a.terminals.find((t) => t.label === normalizeLabel(termA));
  const tb = b.terminals.find((t) => t.label === normalizeLabel(termB));
  if (!ta || !tb) return false;
  return ta.node === tb.node;
}

/**
 * Get all components connected to a given node.
 */
export function componentsAtNode(graph, nodeId) {
  const result = [];
  for (const c of graph.components) {
    for (const t of c.terminals) {
      if (t.node === nodeId) {
        result.push({ componentId: c.id, terminal: t.label });
      }
    }
  }
  return result;
}
