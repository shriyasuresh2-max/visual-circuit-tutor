import { describe, it, expect } from 'vitest';
import { layoutSchematic } from './schematicLayout.js';

const resistor = (id, value, a, b, c) => ({
  id, type: 'resistor', visible_value: value, confidence: 0.95, center: c,
  terminals: [{ label: 'A', position: a }, { label: 'B', position: b }],
});

describe('series circuit regression (terminal order must follow the image)', () => {
  const analysis = {
    components: [
      { id: 'B1', type: 'battery', visible_value: '12V', confidence: 0.95, center: { x: 0.2, y: 0.5 },
        terminals: [{ label: '+', position: { x: 0.2, y: 0.4 } }, { label: '−', position: { x: 0.2, y: 0.6 } }] },
      resistor('R1', '4Ω', { x: 0.35, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.42, y: 0.2 }),
      resistor('R2', '6Ω', { x: 0.65, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.72, y: 0.2 }),
    ],
    connections: [
      { from_component: 'B1', from_terminal: '+', to_component: 'R1', to_terminal: 'A' },
      { from_component: 'R1', from_terminal: 'B', to_component: 'R2', to_terminal: 'A' },
      { from_component: 'R2', from_terminal: 'B', to_component: 'B1', to_terminal: '−' },
    ],
  };

  it('keeps R2 terminal A on the left (image order) and B on the right', () => {
    const layout = layoutSchematic(analysis);
    const r2 = layout.components.find((c) => c.id === 'R2');
    const a = r2.terminals.find((t) => t.label === 'A');
    const b = r2.terminals.find((t) => t.label === 'B');
    expect(a.x).toBeLessThan(b.x);
  });

  it('is a 3-node loop with no wire ending on another wire', () => {
    const layout = layoutSchematic(analysis);
    expect(layout.nodes).toHaveLength(3);
    expect(layout.nodes.every((n) => n.members.length === 2)).toBe(true);
    expect(layout.renderValidation.errors).toEqual([]);
  });
});