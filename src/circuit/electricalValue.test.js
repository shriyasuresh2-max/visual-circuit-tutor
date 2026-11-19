import { describe, expect, it } from 'vitest';
import capture from '../../tests/fixtures/corrupted_ohm_value_analysis.json';
import graveAccentCapture from '../../tests/fixtures/combining_grave_resistance_analysis.json';
import validCapture from '../../tests/fixtures/mixed_return_trace_analysis.json';
import { buildGraph } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { applyComponentValues, valueDisplay } from './componentValue.js';
import { parseDcValue } from './electricalValue.js';
import { solveDcCircuit } from './dcSolver.js';

describe('DC electrical value normalization', () => {
  it.each([
    ['3 Ω', 3, '3 Ω'], ['3Ω', 3, '3 Ω'], ['3 Ω', 3, '3 Ω'], ['3Ω', 3, '3 Ω'],
    ['3 ohm', 3, '3 Ω'], ['3 ohms', 3, '3 Ω'],
    [' 3\u00a0Ω ', 3, '3 Ω'], ['3\u202fK Ω', 3000, '3 kΩ'],
    ['3.3 kΩ', 3300, '3.3 kΩ'], ['3,3 kOhms', 3300, '3.3 kΩ'],
    ['470 mΩ', 0.47, '470 mΩ'], ['6 μΩ', 6e-6, '6 µΩ'],
  ])('normalizes %j as a resistance', (visible_value, value, text) => {
    const component = { type: 'resistor', visible_value };
    const parsed = parseDcValue(component);
    expect(parsed).toMatchObject({ status: 'ok', text });
    expect(parsed.value).toBeCloseTo(value, 12);
    expect(valueDisplay(component)).toMatchObject({ text, warning: null });
  });

  it('normalizes an explicit unit field and preserves an ambiguous suffix', () => {
    const part = { type: 'resistor', value: 3 };
    expect(parseDcValue({ ...part, valueUnit: '\u202Fk Ω\n' }))
      .toMatchObject({ status: 'ok', text: '3 kΩ', value: 3000 });
    expect(parseDcValue({ ...part, valueUnit: '\u0300' }))
      .toMatchObject({ status: 'invalid-unit', rawUnit: '\u0300' });
  });

  it.each([
    ['18 V', 18], ['18V', 18], ['18000\t mV', 18], ['−2 V', -2], ['0 V', 0],
  ])('normalizes a voltage source value %j', (visible_value, value) => {
    expect(parseDcValue({ type: 'battery', visible_value })).toMatchObject({ status: 'ok', value });
  });

  it.each([
    ['3', 'missing-unit'], ['3 0', 'invalid-unit'], ['3 V', 'invalid-unit'],
    ['3\u200bΩ', 'invalid-unit'], ['３Ω', 'invalid-value'], ['0 Ω', 'out-of-range'],
    ['−3 Ω', 'out-of-range'], ['1e999 Ω', 'out-of-range'], ['1e-999 Ω', 'out-of-range'],
  ])('does not infer a resistance from %j', (visible_value, status) => {
    expect(parseDcValue({ type: 'resistor', visible_value })).toMatchObject({ status, raw: visible_value });
  });

  it('replays the exact corrupted extraction, then solves after an explicit correction', () => {
    const graph = buildGraph(capture);
    const part = graph.components.find(({ id }) => id === 'R1');
    expect([...part.valueRaw].map((glyph) => glyph.codePointAt(0))).toEqual([
      0x33, 0x20, 0x306, 0x301, 0x309, 0x20, 0x301, 0x301, 0x2126,
    ]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.incomplete).toBe(false);
    const layout = layoutCircuit(capture, graph);
    expect(layout.renderValidation.errors).toEqual([]);
    expect(valueDisplay(layout.components.find(({ id }) => id === 'R1'))).toEqual({
      text: '3', unit: null, warning: 'Unit unreadable', raw: part.valueRaw,
    });
    expect(solveDcCircuit(graph)).toMatchObject({ ok: false, issues: [{
      code: 'invalid-resistance', componentId: 'R1', message: expect.stringContaining('Edit component values'),
    }] });

    const amended = applyComponentValues(capture, new Map([['R1', '3\u00a0Ω']]));
    const verified = buildGraph(amended);
    expect(verified.nodes).toEqual(graph.nodes);
    expect(valueDisplay(layoutCircuit(amended, verified).components.find(({ id }) => id === 'R1')).text).toBe('3 Ω');
    const solved = solveDcCircuit(verified);
    expect(solved.ok).toBe(true);
    for (const [componentId, expected] of [['R1', 18 / 7], ['R2', 12 / 7], ['R3', 6 / 7]]) {
      expect(solved.branches.find((branch) => branch.componentId === componentId).current).toBeCloseTo(expected, 12);
    }
  });

  it('keeps the exact three combining-grave units visible for correction and blocks solving', () => {
    const graph = buildGraph(graveAccentCapture);
    const layout = layoutCircuit(graveAccentCapture, graph);
    expect(graph.incomplete).toBe(false);
    expect(layout.renderValidation.errors).toEqual([]);
    const resistors = graph.components.filter(({ type }) => type === 'resistor');
    expect(resistors.map(({ valueRaw }) => [...valueRaw].map((glyph) => glyph.codePointAt(0)))).toEqual([
      [0x33, 0x20, 0x0300], [0x36, 0x20, 0x0300], [0x31, 0x32, 0x20, 0x0300],
    ]);
    for (const [index, text] of ['3', '6', '12'].entries()) {
      const { id, valueRaw } = resistors[index];
      const drawn = layout.components.find((component) => component.id === id);
      expect(valueDisplay(drawn)).toEqual({ text, raw: valueRaw, warning: 'Unit unreadable', unit: null });
    }
    const result = solveDcCircuit(graph);
    expect(result.ok).toBe(false);
    expect(result.issues.map(({ code, componentId }) => [code, componentId]))
      .toEqual(resistors.map(({ id }) => ['invalid-resistance', id]));
    expect(parseDcValue(graph.components.find(({ id }) => id === 'V1')))
      .toMatchObject({ status: 'ok', raw: '18 V', value: 18 });
  });

  it('solves the valid saved extraction with all three values, without edits', () => {
    const graph = buildGraph(validCapture);
    const layout = layoutCircuit(validCapture, graph);
    expect(layout.renderValidation.errors).toEqual([]);
    const resistors = layout.components.filter(({ type }) => type === 'resistor');
    expect(resistors.map((part) => valueDisplay(part).text)).toEqual(['3 Ω', '6 Ω', '12 Ω']);
    const result = solveDcCircuit(graph);
    expect(result.ok).toBe(true);
    for (const [componentId, amps] of [['R1', 18 / 7], ['R2', 12 / 7], ['R3', 6 / 7]]) {
      expect(result.branches.find((branch) => branch.componentId === componentId).current).toBeCloseTo(amps, 12);
    }
  });
});
