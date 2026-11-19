/**
 * componentValue — how a printed component value is presented to the user.
 *
 * The number and its unit are shown exactly as they were read. When extraction
 * produced a glyph where a unit belongs that is not a unit at all, the number is
 * still shown, but the value is flagged instead of silently losing the unit:
 * the drawing never prints a unit it does not have, and never invents one from
 * the component type or the circuit around it.
 *
 * The original text is kept on the component (`valueRaw`) and in its diagnostic,
 * so the OCR result is never discarded — only marked as unreadable.
 */

import { splitValue } from './electricalGraph.js';

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
