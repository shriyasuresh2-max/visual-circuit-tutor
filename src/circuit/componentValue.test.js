import { describe, it, expect } from 'vitest';
import { valueDisplay, UNREADABLE_UNIT_WARNING } from './componentValue.js';
import { buildGraph } from './electricalGraph.js';

describe('component value display', () => {
  it('shows a recognised unit exactly as read, with no warning', () => {
    const shown = valueDisplay({ valueRaw: '4 Ω', value: '4 Ω' });
    expect(shown).toEqual({ text: '4 Ω', unit: 'Ω', warning: null, raw: null });
    expect(valueDisplay({ visible_value: '12 V' }).text).toBe('12 V');
  });

  it('shows the number and flags an unreadable unit instead of dropping it', () => {
    const shown = valueDisplay({ valueRaw: '100 Ά', value: '100' });
    expect(shown.text).toBe('100');
    expect(shown.warning).toBe(UNREADABLE_UNIT_WARNING);
    // The OCR result is still available to the user, not discarded.
    expect(shown.raw).toBe('100 Ά');
  });

  it('leaves a value with no unit alone', () => {
    expect(valueDisplay({ valueRaw: '6', value: '6' })).toEqual({
      text: '6', unit: null, warning: null, raw: null,
    });
    expect(valueDisplay({ value: '—' }).text).toBe('—');
    expect(valueDisplay(null)).toEqual({ text: null, unit: null, warning: null, raw: null });
  });

  it('presents a value straight from a raw analysis component', () => {
    expect(valueDisplay({ id: 'R1', visible_value: '100 Ά' }).warning).toBe(UNREADABLE_UNIT_WARNING);
    expect(valueDisplay({ id: 'R1', visible_value: '100 Ω' }).warning).toBeNull();
  });

  it('keeps the extracted text and the flag on the component a layout draws', () => {
    const graph = buildGraph({
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        { id: 'V1', type: 'battery', visible_value: '12 V', terminals: [{ label: '+' }, { label: '-' }] },
        { id: 'R1', type: 'resistor', visible_value: '4 Ά', terminals: [{ label: 'A' }, { label: 'B' }] },
      ],
      connections: [
        { from_component: 'V1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
        { from_component: 'R1', from_terminal: 'B', to_component: 'V1', to_terminal: '-' },
      ],
    });
    const r1 = graph.components.find((c) => c.id === 'R1');
    expect(r1.value).toBe('4');
    expect(r1.valueRaw).toBe('4 Ά');
    expect(r1.valueUnitRecognized).toBe(false);
    expect(valueDisplay(r1)).toMatchObject({ text: '4', warning: UNREADABLE_UNIT_WARNING, raw: '4 Ά' });
  });
});
