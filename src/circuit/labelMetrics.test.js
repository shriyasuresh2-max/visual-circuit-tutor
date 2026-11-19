import { describe, it, expect } from 'vitest';
import { layoutCircuit } from './circuitLayout.js';
import { LABEL_CARD, labelSize } from './labelMetrics.js';
import { valueDisplay } from './componentValue.js';

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
});

const geo = (id, type, value, t0, t1) => ({
  id,
  type,
  visible_value: value,
  confidence: 0.95,
  center: { x: (t0[1] + t1[1]) / 2, y: (t0[2] + t1[2]) / 2 },
  terminals: [
    { label: t0[0], position: { x: t0[1], y: t0[2] } },
    { label: t1[0], position: { x: t1[1], y: t1[2] } },
  ],
});

const overlap = (a, b, margin = 0) => (
  a.minX - margin < b.maxX &&
  b.minX - margin < a.maxX &&
  a.minY - margin < b.maxY &&
  b.minY - margin < a.maxY
);

const boxSize = (box) => ({ width: box.maxX - box.minX, height: box.maxY - box.minY });

// Three resistors packed close together, two of them with an unreadable unit,
// so their wider cards have to be laid out without touching each other.
const crowded = {
  contains_circuit: true,
  circuit_type: 'parallel',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.1, 0.35], ['−', 0.1, 0.65]),
    geo('R1', 'resistor', '100 Ά', ['A', 0.42, 0.3], ['B', 0.42, 0.7]),
    geo('R2', 'resistor', '100 Ά', ['A', 0.52, 0.3], ['B', 0.52, 0.7]),
    geo('R3', 'resistor', '4 Ω', ['A', 0.62, 0.3], ['B', 0.62, 0.7]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'),
    conn('V1', '+', 'R2', 'A'),
    conn('V1', '+', 'R3', 'A'),
    conn('V1', '−', 'R1', 'B'),
    conn('V1', '−', 'R2', 'B'),
    conn('V1', '−', 'R3', 'B'),
  ],
};

// The same circuit with every value readable: only the labels may differ.
const readable = {
  ...crowded,
  components: crowded.components.map((c) => ({ ...c, visible_value: '100 Ω' })),
};

const layoutOf = (analysis) => layoutCircuit(analysis);
const byId = (layout, id) => layout.components.find((c) => c.id === id);

describe('component label sizing', () => {
  it('reserves the plain card for a component whose unit was read', () => {
    const layout = layoutOf(crowded);
    const r3 = byId(layout, 'R3');
    expect(valueDisplay(r3).warning).toBeNull();
    expect(labelSize(r3)).toEqual({ width: LABEL_CARD.width, height: LABEL_CARD.height });
    expect(boxSize(r3.labelBox)).toEqual({ width: LABEL_CARD.width, height: LABEL_CARD.height });
  });

  it('reserves the taller, wider card for a component whose unit was not read', () => {
    const layout = layoutOf(crowded);
    const r1 = byId(layout, 'R1');
    expect(valueDisplay(r1).warning).toBeTruthy();
    expect(labelSize(r1)).toEqual({
      width: LABEL_CARD.warningWidth,
      height: LABEL_CARD.warningHeight,
    });
    expect(boxSize(r1.labelBox)).toEqual({
      width: LABEL_CARD.warningWidth,
      height: LABEL_CARD.warningHeight,
    });
  });

  it('gives the renderer exactly the box the layout reserved', () => {
    const layout = layoutOf(crowded);
    for (const comp of layout.components) {
      // The renderer draws from `comp.labelSize ?? labelSize(comp)`; the layout
      // reserves from `comp.labelSize`. They are the same object, so the drawn
      // card can never exceed its reservation.
      expect(comp.labelSize).toEqual(labelSize(comp));
      expect(boxSize(comp.labelBox)).toEqual(comp.labelSize);
    }
  });

  it('keeps crowded labels clear of components and of each other', () => {
    const layout = layoutOf(crowded);
    const comps = layout.components;
    for (const a of comps) {
      for (const b of comps) {
        if (a.id === b.id) continue;
        expect(overlap(a.labelBox, b.labelBox), `${a.id} label overlaps ${b.id} label`).toBe(false);
        expect(overlap(a.labelBox, b.symbolBox, 2), `${a.id} label overlaps ${b.id} symbol`).toBe(false);
      }
    }
  });

  it('stays inside the canvas', () => {
    const layout = layoutOf(crowded);
    for (const comp of layout.components) {
      expect(comp.labelBox.minX).toBeGreaterThanOrEqual(0);
      expect(comp.labelBox.minY).toBeGreaterThanOrEqual(0);
      expect(comp.labelBox.maxX).toBeLessThanOrEqual(layout.bounds.width);
      expect(comp.labelBox.maxY).toBeLessThanOrEqual(layout.bounds.height);
    }
  });

  it('labels only — component geometry is untouched by the warning', () => {
    const warned = layoutOf(crowded);
    const plain = layoutOf(readable);
    for (const a of warned.components) {
      const b = byId(plain, a.id);
      expect(a.center).toEqual(b.center);
      expect(a.axis).toEqual(b.axis);
      expect(a.terminals.map((t) => [t.x, t.y])).toEqual(b.terminals.map((t) => [t.x, t.y]));
    }
    // The electrical graph is identical too.
    expect(warned.nodes.map((n) => [n.id, [...n.members].sort()]))
      .toEqual(plain.nodes.map((n) => [n.id, [...n.members].sort()]));
  });
});
