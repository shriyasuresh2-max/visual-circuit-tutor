/**
 * componentValue — how a printed component value is presented to the user.
 *
 * DC values use the same strict parser as the solver. Other component
 * kinds keep their existing display behavior.
 *
 * The original text is kept on the component (`valueRaw`) and in its diagnostic,
 * so the OCR result is never discarded — only marked as unreadable.
 */

import { splitValue } from './electricalGraph.js';
import { parseDcValue } from './electricalValue.js';

/** Concise wording for a value whose unit could not be read. */
export const UNREADABLE_UNIT_WARNING = 'Unit unreadable';

/**
 * Present one component's value.
 *
 * @param {Object} component - layout, graph or raw analysis component
 * @returns {{text: string|null, unit: string|null, warning: string|null, raw: string|null}}
 *   `text` is what to draw, `warning` is set when the unit was unreadable, and
 *   `raw` is the untouched extracted text in that case.
 */
export function valueDisplay(component) {
  const electrical = parseDcValue(component);
  if (electrical) {
    const warning = electrical.status === 'invalid-unit' ? UNREADABLE_UNIT_WARNING
      : electrical.status === 'missing-unit' ? 'Unit missing'
      : electrical.status === 'invalid-value' || electrical.status === 'out-of-range' ? 'Invalid value'
      : null;
    return {
      text: electrical.text ?? (warning ? '—' : null),
      unit: electrical.unit,
      warning,
      raw: warning ? electrical.raw : null,
    };
  }
  const raw =
    component?.valueRaw ?? component?.visible_value ?? component?.value ?? null;
  const parsed = splitValue(raw);
  const unreadable = parsed.unitRecognized === false;
  return {
    text: parsed.value ?? null,
    unit: parsed.unit ?? null,
    warning: unreadable ? UNREADABLE_UNIT_WARNING : null,
    raw: unreadable ? raw : null,
  };
}

/** Replace extracted values with values explicitly entered for this upload. */
export function applyComponentValues(analysis, overrides) {
  if (!analysis || overrides.size === 0) return analysis;
  return {
    ...analysis,
    components: analysis.components.map((component) =>
      overrides.has(component.id)
        ? { ...component, visible_value: overrides.get(component.id) }
        : component,
    ),
  };
}

/** Apply reviewed values and arrow directions without changing any node evidence. */
export function applyComponentEdits(analysis, edits) {
  if (!analysis || edits.size === 0) return analysis;
  return {
    ...analysis,
    components: analysis.components.map((component) => {
      const edit = edits.get(component.id);
      return edit ? {
        ...component,
        ...('visible_value' in edit ? { visible_value: edit.visible_value } : {}),
        ...(component.type === 'current_source' && 'currentDirection' in edit
          ? { currentDirection: edit.currentDirection } : {}),
      } : component;
    }),
  };
}
