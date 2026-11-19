/**
 * savedCircuit — the artefact the editor hands to the solving stage.
 *
 * A plain, self-contained snapshot of the circuit as the student saved it: the
 * electrical identity of every component and node, the connections that were
 * confirmed (plus any still provisional), and the final drawn geometry. It is
 * derived from a finished layout, so it carries whatever the user moved or
 * rotated rather than what the layout engine would re-derive from the image.
 *
 * Deliberately NOT an analysis object: the original image and the user's
 * question stay in application state, and saving never overwrites either.
 */

function summarizeConnection(conn) {
  if (!conn) return null;
  return {
    from_component: conn.from_component ?? null,
    from_terminal: conn.from_terminal ?? null,
    to_component: conn.to_component ?? null,
    to_terminal: conn.to_terminal ?? null,
    confidence: conn.confidence ?? null,
    status: conn.status ?? null,
    provenance: Array.isArray(conn.provenance) ? [...conn.provenance] : null,
    confirmed: conn.confirmed !== false,
  };
}

function summarizeTerminal(terminal) {
  return {
    label: terminal.label ?? null,
    node: terminal.node ?? null,
    x: terminal.x ?? null,
    y: terminal.y ?? null,
  };
}

/**
 * Is this layout a real, complete reconstruction worth keeping?
 *
 * A failed, incomplete or geometrically invalid layout must never be presented
 * as a saved circuit, so the automatic save asks this first. Kept beside the
 * serialiser so the rule lives in one place rather than in a component effect.
 *
 * @param {Object} layout - layout returned by `layoutCircuit`/`rerouteLayout`
 * @returns {boolean}
 */
export function isSavableLayout(layout) {
  if (!layout || !layout.ok) return false;
  if (layout.incomplete) return false;
  if (layout.renderValidation && layout.renderValidation.isValid === false) return false;
  return true;
}

/**
 * Recover the axis a saved component was drawn along.
 *
 * Derived from the saved terminal geometry rather than from `angle`, because
 * `angle` also encodes source polarity (+180°) and would be ambiguous here. The
 * direction is normalised, never snapped to a cardinal: a component the image
 * drew diagonally is saved and restored diagonally.
 */
function axisFromTerminals(terminals) {
  const t0 = terminals?.[0];
  const t1 = terminals?.[1];
  if (!t0 || !t1) return null;
  const dx = t1.x - t0.x;
  const dy = t1.y - t0.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * Turn a saved document back into the editor's overrides, so a freshly mounted
 * diagram can resume from the saved circuit instead of the pristine
 * reconstruction.
 *
 * Only geometry that the document records can be recovered: component centres
 * and axes, junction positions and manual wire-segment shifts. A document saved
 * before wire shifts were recorded simply restores the first two.
 *
 * @param {Object} layout - pristine layout for the same reconstruction
 * @param {Object} savedCircuit - document built by `buildSavedCircuit`
 * @returns {{ componentEdits: Map, nodeEdits: Map, wireEdits: Map }}
 */
export function overridesFromSavedCircuit(layout, savedCircuit) {
  const componentEdits = new Map();
  const nodeEdits = new Map();
  const wireEdits = new Map();
  if (!layout || !layout.ok || !savedCircuit) return { componentEdits, nodeEdits, wireEdits };

  const savedById = new Map(
    (Array.isArray(savedCircuit.components) ? savedCircuit.components : []).map((c) => [c.id, c]),
  );

  for (const base of layout.components || []) {
    const saved = savedById.get(base.id);
    if (!saved) continue;

    const edit = {};
    if (saved.center && (saved.center.x !== base.center.x || saved.center.y !== base.center.y)) {
      edit.center = { x: saved.center.x, y: saved.center.y };
    }
    const axis = axisFromTerminals(saved.terminals);
    // Rounding of the drawn terminals makes the recovered direction differ from
    // the layout's own by a hair; only a real rotation is an edit.
    const turned = axis && (Math.abs(axis.x - base.axis.x) > 1e-3 || Math.abs(axis.y - base.axis.y) > 1e-3);
    if (turned) edit.axis = axis;
    if (Object.keys(edit).length > 0) componentEdits.set(base.id, edit);
  }

  const savedNodes = new Map(
    (Array.isArray(savedCircuit.nodes) ? savedCircuit.nodes : []).map((n) => [n.id, n]),
  );
  for (const base of layout.nodes || []) {
    const saved = savedNodes.get(base.id);
    if (!saved) continue;
    if (saved.x !== base.x || saved.y !== base.y) {
      nodeEdits.set(base.id, { x: saved.x, y: saved.y });
    }
  }

  // Manual wire-segment shifts, keyed exactly as the editor keys them, so a
  // re-mounted diagram redraws the wire where the user left it.
  for (const entry of Array.isArray(savedCircuit.wireEdits) ? savedCircuit.wireEdits : []) {
    if (!entry?.key || !Array.isArray(entry.segments) || entry.segments.length === 0) continue;
    wireEdits.set(
      entry.key,
      entry.segments
        .filter((s) => s && Array.isArray(s.span) && s.span.length === 2)
        .map((s) => ({ dir: s.dir === 'v' ? 'v' : 'h', coord: s.coord, span: [s.span[0], s.span[1]], end: s.end ?? null })),
    );
  }

  return { componentEdits, nodeEdits, wireEdits };
}

/**
 * Build the saved-circuit document from a rendered layout.
 *
 * @param {Object} layout - layout returned by `rerouteLayout` (edits applied)
 * @param {string} [savedAt] - ISO timestamp; injectable for callers that need it
 * @param {Map|null} [wireEdits] - wire-segment overrides on screen, keyed the
 *   way the editor keys them; recorded so a reopened diagram keeps them
 * @returns {Object|null} plain JSON-serialisable document, or null if there is
 *   no usable layout to save
 */
export function buildSavedCircuit(layout, savedAt = new Date().toISOString(), wireEdits = null) {
  if (!layout || !layout.ok) return null;

  return {
    savedAt,
    version: 1,
    source: 'reconstructed-circuit',
    bounds: layout.bounds
      ? { width: layout.bounds.width, height: layout.bounds.height }
      : null,
    components: (layout.components || []).map((c) => ({
      id: c.id,
      type: c.type,
      value: c.value ?? null,
      confidence: c.confidence ?? null,
      status: c.status ?? null,
      notes: c.notes ?? null,
      orientation: c.orientation ?? null,
      angle: c.angle ?? null,
      center: c.center ? { x: c.center.x, y: c.center.y } : null,
      terminals: (c.terminals || []).map(summarizeTerminal),
    })),
    nodes: (layout.nodes || []).map((n) => ({
      id: n.id,
      members: Array.isArray(n.members) ? [...n.members] : [],
      x: n.x,
      y: n.y,
    })),
    connections: (layout.connections || []).map(summarizeConnection).filter(Boolean),
    provisional: (layout.provisional || []).map(summarizeConnection).filter(Boolean),
    // Geometry only: the electrical graph is untouched by a wire shift. Empty
    // for a pristine layout, so the field is additive and old readers ignore it.
    wireEdits: wireEdits && wireEdits.size > 0
      ? [...wireEdits.entries()].map(([key, segments]) => ({
        key,
        segments: (Array.isArray(segments) ? segments : []).map((s) => ({
          dir: s?.dir === 'v' ? 'v' : 'h',
          coord: s?.coord ?? null,
          span: Array.isArray(s?.span) ? [s.span[0], s.span[1]] : null,
          end: s?.end ?? null,
        })),
      }))
      : [],
    validation: {
      isValid: layout.renderValidation ? layout.renderValidation.isValid !== false : null,
      errors: [...(layout.renderValidation?.errors || [])],
      warnings: [...(layout.renderValidation?.warnings || [])],
    },
  };
}
