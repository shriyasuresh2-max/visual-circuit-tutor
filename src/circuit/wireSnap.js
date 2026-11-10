/**
 * wireSnap — pure snap-target detection for the wire-endpoint preview.
 *
 * This module answers exactly one question: "the user is holding a wire
 * endpoint here — what visible thing is it closest to?". It reads the layout
 * that is already on screen (components, terminals, junctions, wires and the
 * crossing markers the renderer draws) and returns a description of the
 * nearest candidate. It never edits anything.
 *
 * A snap target is a *preview*, not an electrical join: nothing here creates,
 * removes or merges a connection, and the returned object carries no graph
 * mutation path. Keeping the geometry-only view separate is what lets the
 * renderer show "you could connect here" long before the electrical editing
 * step exists.
 */

import { wireOverrideKey } from './schematicLayout.js';

/** Snap radius in SVG user units at 100% zoom. */
export const DEFAULT_SNAP_DISTANCE = 18;

/** Two candidates closer than this are treated as equally near. */
const TIE_EPS = 0.5;

/** Terminals win ties over junctions, which win ties over wire midpoints. */
const TYPE_PRIORITY = { terminal: 0, junction: 1, wire: 2 };

/**
 * A wire point this close to a documented crossing is ambiguous: snapping
 * there would draw a connection at a spot the diagram explicitly marks as two
 * wires passing without touching, so it is never offered as a target.
 */
const CROSSING_EXCLUSION = 8;

/** Distance a target must be ignored when it sits on the drag's start point. */
const DEFAULT_IGNORE_RADIUS = 3;

/**
 * A wire projection this close to a terminal or junction is the same spot, not
 * a separate target: the thing the wire is attached to is the better answer.
 */
const DUPLICATE_RADIUS = 4;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Snap radius in user units for the current zoom level.
 *
 * The viewBox shrinks as the user zooms in, so user units get physically
 * larger on screen; dividing by the zoom keeps the snap radius the same
 * number of screen pixels at every level.
 *
 * @param {number} zoom - current view scale (1 = 100%)
 * @param {number} base - radius at 100% zoom, in user units
 * @returns {number} radius in user units at this zoom
 */
export function snapDistanceForZoom(zoom = 1, base = DEFAULT_SNAP_DISTANCE) {
  const k = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return base / k;
}

function inBounds(point, bounds) {
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return true;
  return point.x >= 0 && point.y >= 0 && point.x <= bounds.width && point.y <= bounds.height;
}

/** Nearest point on the segment a→b, plus its distance (clamped to the ends). */
export function projectOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return { point: { x: a.x, y: a.y }, distance: dist(point, a) };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const projected = { x: a.x + t * dx, y: a.y + t * dy };
  return { point: projected, distance: dist(point, projected) };
}

/** Every electrical component terminal in the layout, as snap candidates. */
function terminalTargets(layout, point, bounds) {
  const targets = [];
  for (const comp of layout.components ?? []) {
    for (const terminal of comp?.terminals ?? []) {
      const at = { x: terminal.x, y: terminal.y };
      if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      if (!inBounds(at, bounds)) continue;
      targets.push({
        type: 'terminal',
        eligible: true,
        point: at,
        distance: dist(point, at),
        key: `terminal:${comp.id}.${terminal.label}`,
        componentId: comp.id,
        componentType: comp.type ?? null,
        terminalLabel: terminal.label,
        terminalKey: `${comp.id}.${terminal.label}`,
        nodeId: terminal.node ?? null,
      });
    }
  }
  return targets;
}

/** Every drawn junction dot, as snap candidates (keyed by electrical node). */
function junctionTargets(layout, point, bounds) {
  const targets = [];
  for (const junction of layout.junctions ?? []) {
    const at = { x: junction.x, y: junction.y };
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    if (!inBounds(at, bounds)) continue;
    const nodeId = junction.nodeId ?? junction.id;
    targets.push({
      type: 'junction',
      eligible: junction.isJunction !== false,
      point: at,
      distance: dist(point, at),
      key: `junction:${nodeId}`,
      junctionId: junction.id,
      nodeId,
      memberCount: junction.memberCount ?? junction.members?.length ?? null,
    });
  }
  return targets;
}

/**
 * The closest point on every other wire's polyline.
 *
 * One candidate per segment so the nearest segment of the nearest wire wins;
 * a projected point that lands on a documented crossing is kept but marked
 * ineligible, which is how "crossing wires are not junctions" is enforced.
 */
function wireTargets(layout, point, bounds, ignoreKeys) {
  const targets = [];
  const wires = layout.allWires ?? layout.wires ?? [];
  const crossings = layout.crossings ?? [];

  for (const wire of wires) {
    if (!wire?.points || wire.points.length < 2) continue;
    const key = wireOverrideKey(wire);
    if (ignoreKeys.has(key) || ignoreKeys.has(wire.id)) continue;

    for (let i = 0; i < wire.points.length - 1; i += 1) {
      const a = wire.points[i];
      const b = wire.points[i + 1];
      if (a.x === b.x && a.y === b.y) continue;

      const projection = projectOnSegment(point, a, b);
      if (!inBounds(projection.point, bounds)) continue;

      const onCrossing = crossings.some((crossing) => (
        crossing?.point && dist(crossing.point, projection.point) <= CROSSING_EXCLUSION
      ));

      targets.push({
        type: 'wire',
        eligible: !onCrossing,
        point: projection.point,
        distance: projection.distance,
        key: `wire:${key}:${i}`,
        wireId: wire.id,
        wireKey: key,
        nodeId: wire.node ?? null,
        segmentIndex: i,
        segment: { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } },
      });
    }
  }
  return targets;
}

/**
 * Build every snap candidate for `point` from the current layout geometry.
 *
 * Wire candidates are projected onto their segment, so the returned `point` is
 * where the endpoint would actually land. Targets outside the canvas are
 * dropped; ambiguity (a documented crossing) is reported as `eligible: false`
 * rather than silently removed, so callers can explain why nothing snapped.
 *
 * @param {Object} layout - rendered layout (components/nodes/wires/junctions)
 * @param {{x,y}} point - dragged endpoint in SVG user space
 * @param {{ignoreWireKeys?: string[]}} [options] - wires that cannot be targets
 * @returns {Array<Object>} candidates with `type`, `point`, `distance`, `eligible`
 */
export function collectSnapTargets(layout, point, { ignoreWireKeys = [] } = {}) {
  if (!layout || !point) return [];
  const bounds = layout.bounds ?? null;
  const ignoreKeys = new Set(ignoreWireKeys.filter(Boolean));

  const anchors = [
    ...terminalTargets(layout, point, bounds),
    ...junctionTargets(layout, point, bounds),
  ];

  // A wire point that lands on a terminal or junction duplicates that target
  // (every wire end is drawn at one), and offering it twice would let the
  // nearest-segment arithmetic silently outrank the connected thing.
  const wires = wireTargets(layout, point, bounds, ignoreKeys).filter(
    (candidate) => !anchors.some((anchor) => dist(anchor.point, candidate.point) <= DUPLICATE_RADIUS),
  );

  return [...anchors, ...wires];
}

/**
 * Nearest eligible snap target within `maxDistance`, or `null`.
 *
 * Ordering is fully determined: distance first, then target type (terminal →
 * junction → wire), then key, so two equidistant candidates always resolve the
 * same way instead of flickering with pointer jitter.
 *
 * @param {Object} layout - rendered layout
 * @param {{x,y}} point - dragged endpoint in SVG user space
 * @param {Object} [options]
 * @param {number} [options.maxDistance] - radius in user units
 * @param {string[]} [options.ignoreWireKeys] - wires excluded as targets
 * @param {Array<{x,y}>} [options.ignorePoints] - positions that are not "somewhere else"
 * @param {number} [options.ignoreRadius] - how near an ignore point still counts as the same place
 * @returns {Object|null} the chosen target, including its `distance`
 */
export function findSnapTarget(layout, point, {
  maxDistance = DEFAULT_SNAP_DISTANCE,
  ignoreWireKeys = [],
  ignorePoints = [],
  ignoreRadius = DEFAULT_IGNORE_RADIUS,
} = {}) {
  if (!layout || !point) return null;
  const limit = Number.isFinite(maxDistance) && maxDistance >= 0 ? maxDistance : DEFAULT_SNAP_DISTANCE;

  const candidates = collectSnapTargets(layout, point, { ignoreWireKeys })
    .filter((target) => target.eligible)
    .filter((target) => target.distance <= limit + 1e-6)
    .filter((target) => !ignorePoints.some((p) => p && dist(p, target.point) <= ignoreRadius));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (Math.abs(a.distance - b.distance) > TIE_EPS) return a.distance - b.distance;
    const priority = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (priority !== 0) return priority;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return candidates[0];
}

/**
 * Short human label for a target, used by the preview and its accessible text.
 * @param {Object|null} target
 * @returns {string}
 */
export function snapTargetLabel(target) {
  if (!target) return '';
  if (target.type === 'terminal') return target.terminalKey ?? 'terminal';
  if (target.type === 'junction') return target.nodeId ?? 'junction';
  if (target.type === 'wire') return `wire ${target.wireId}`;
  return '';
}
