/**
 * labelMetrics — the one place a component label card's size is decided.
 *
 * The layout engine reserves a box for every label and keeps it clear of symbols,
 * wires, other labels and the canvas edge; the SVG renderer draws the card. Both
 * must use the exact same numbers, or a card can be drawn larger than the space
 * reserved for it and overlap a neighbour. So the size lives here, is derived
 * from what the card will actually contain, and is used by both sides.
 *
 * Sizing is content-aware but not component-specific: a card carrying the
 * unreadable-unit warning needs one more line, so it reserves a taller box.
 */

import { valueDisplay } from './componentValue.js';

/** Card geometry. Width/height are the reserved box, not a font guess. */
export const LABEL_CARD = {
  /** A card showing an id and a value. */
  width: 54,
  height: 30,
  /** A card that also carries the "Unit unreadable" line. */
  warningWidth: 60,
  warningHeight: 34,
  cornerRadius: 4,
  /** Clearance kept between a card and the canvas edge. */
  edgeGap: 6,
};

export const NODE_LABEL_FONT_SIZE = 9;

export function nodeLabelPosition(node) {
  return { x: node.x + 8, y: node.y - 8 };
}

export function nodeLabelBox(node) {
  const { x, y } = nodeLabelPosition(node);
  return {
    minX: x,
    maxX: x + String(node.id).length * NODE_LABEL_FONT_SIZE * 0.65,
    minY: y - NODE_LABEL_FONT_SIZE,
    maxY: y + 2,
  };
}

/**
 * The exact size of the card a component's label needs.
 *
 * @param {Object} component - layout, graph or raw analysis component
 * @returns {{width: number, height: number}}
 */
export function labelSize(component) {
  const { warning } = valueDisplay(component);
  return warning
    ? { width: LABEL_CARD.warningWidth, height: LABEL_CARD.warningHeight }
    : { width: LABEL_CARD.width, height: LABEL_CARD.height };
}

/**
 * The box a card of `size` occupies when centred on `point`.
 *
 * @param {{x:number,y:number}} point - card centre
 * @param {{width:number,height:number}} size - from `labelSize`
 * @returns {{minX:number,maxX:number,minY:number,maxY:number}}
 */
export function labelBoxAt(point, size) {
  return {
    minX: point.x - size.width / 2,
    maxX: point.x + size.width / 2,
    minY: point.y - size.height / 2,
    maxY: point.y + size.height / 2,
  };
}

/**
 * Half of a card measured along a screen direction, used to offset a card clear
 * of the symbol it labels.
 *
 * @param {{x:number,y:number}} dir - screen direction
 * @param {{width:number,height:number}} size - from `labelSize`
 */
export function cardHalfAlong(dir, size) {
  return dir.x !== 0 ? size.width / 2 : size.height / 2;
}
