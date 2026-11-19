import { describe, it, expect } from 'vitest';
import { layoutCircuit } from './circuitLayout.js';
import { buildGraph } from './electricalGraph.js';
import { buildSavedCircuit, overridesFromSavedCircuit } from './savedCircuit.js';
import { rerouteLayout, symbolAngle } from './schematicLayout.js';

/* ------------------------------------------------------------------ *
 * Generic fixtures — geometry and values only, no named circuit
 * ------------------------------------------------------------------ */

/** A two-terminal part centred on (cx, cy) at `angleDeg` in image space. */
const angled = (id, type, value, cx, cy, angleDeg, halfLen, labels = ['A', 'B']) => {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * halfLen;
  const dy = Math.sin(rad) * halfLen;
  return {
    id,
    type,
    visible_value: value,
    confidence: 0.95,
    status: 'confirmed',
    orientation: angleDeg,
    center: { x: cx, y: cy },
    terminals: [
      { label: labels[0], position: { x: cx - dx, y: cy - dy } },
      { label: labels[1], position: { x: cx + dx, y: cy + dy } },
    ],
  };
};

const conn = (fc, ft, tc, tt) => ({
  from_component: fc,
  from_terminal: ft,
  to_component: tc,
  to_terminal: tt,
  confidence: 0.95,
  status: 'confirmed',
});

/**
 * A crowded layout: a source on the left, four short diagonal branches around a
 * wide middle part whose terminals reach the two side nodes. Chosen for density
 * (labels have almost nowhere to go), not for any particular circuit.
 */
const crowded = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    angled('S1', 'battery', '10 V', 0.14, 0.52, 90, 0.02, ['+', '−']),
    angled('P1', 'resistor', '101 Ω', 0.33, 0.36, -45, 0.05),
    angled('P2', 'resistor', '202 Ω', 0.55, 0.36, 45, 0.05),
    angled('P3', 'resistor', '303 Ω', 0.33, 0.68, 45, 0.05),
    angled('P4', 'resistor', '404 Ω', 0.55, 0.68, -45, 0.05),
    angled('P5', 'resistor', '505 Ω', 0.44, 0.52, 0, 0.18),
  ],
  connections: [
    conn('S1', '+', 'P1', 'A'),
    conn('P1', 'A', 'P2', 'A'),
    conn('P1', 'B', 'P5', 'A'),
    conn('P3', 'B', 'S1', '−'),
    conn('P2', 'A', 'P1', 'A'),
    conn('P2', 'B', 'P5', 'B'),
    conn('P4', 'A', 'P2', 'B'),
    conn('P4', 'B', 'P3', 'B'),
    conn('P3', 'A', 'P1', 'B'),
  ],
};

const boxDist = (box, other) => Math.hypot(
  Math.max(other.minX - box.maxX, 0, box.minX - other.maxX),
  Math.max(other.minY - box.maxY, 0, box.minY - other.maxY),
);

const overlaps = (a, b, margin = 0) => (
  a.minX - margin < b.maxX && b.minX - margin < a.maxX &&
  a.minY - margin < b.maxY && b.minY - margin < a.maxY
);

describe('component identity survives graph, layout and save', () => {
  const graph = buildGraph(crowded);
  const layout = layoutCircuit(crowded);

  it('keeps every id, type and value with its own component', () => {
    for (const source of crowded.components) {
      const drawn = layout.components.find((c) => c.id === source.id);
      expect(drawn, `${source.id} missing from the layout`).toBeTruthy();
      expect(drawn.type).toBe(source.type);
      expect(drawn.value).toBe(graph.components.find((c) => c.id === source.id).value);
      // The value that belongs to this id, never a neighbour's.
      expect(drawn.value).toBe(source.visible_value);
    }
    const values = layout.components.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps terminal labels, node membership and coordinates together', () => {
    for (const drawn of layout.components) {
      const node = graph.components.find((c) => c.id === drawn.id);
      expect(drawn.terminals.map((t) => t.label)).toEqual(node.terminals.map((t) => t.label));
      expect(drawn.terminals.map((t) => t.node)).toEqual(node.terminals.map((t) => t.node));
      expect(drawn.nodeA).toBe(node.terminals[0].node);
      expect(drawn.nodeB).toBe(node.terminals[1].node);
      // The drawn terminals are the component's own ends, on its own axis.
      const [t0, t1] = drawn.terminals;
      expect(t0.x).toBe(drawn.x1);
      expect(t0.y).toBe(drawn.y1);
      expect(t1.x).toBe(drawn.x2);
      expect(t1.y).toBe(drawn.y2);
      const mid = { x: (t0.x + t1.x) / 2, y: (t0.y + t1.y) / 2 };
      expect(Math.hypot(mid.x - drawn.center.x, mid.y - drawn.center.y)).toBeLessThan(1.5);
    }
  });

  it('keeps diagonal parts diagonal on the image axis', () => {
    for (const source of crowded.components) {
      const drawn = layout.components.find((c) => c.id === source.id);
      const [a, b] = source.terminals;
      const ix = b.position.x - a.position.x;
      const iy = b.position.y - a.position.y;
      const il = Math.hypot(ix, iy);
      const dx = drawn.x2 - drawn.x1;
      const dy = drawn.y2 - drawn.y1;
      const dl = Math.hypot(dx, dy);
      const dot = (ix / il) * (dx / dl) + (iy / il) * (dy / dl);
      // Same direction (the canvas' aspect may change the slope slightly), or
      // exactly reversed for a polarised source, whose symbol is flipped so its
      // + plate faces the + terminal. Never snapped onto a canvas axis.
      expect(dot > 0.9 || dot < -0.9, `${source.id} axis rotated away from the image`).toBe(true);
      if (Math.abs(ix / il) > 0.25 && Math.abs(iy / il) > 0.25) {
        // A diagonal part is still diagonal in the drawing.
        expect(Math.abs(dx / dl) > 0.05 && Math.abs(dy / dl) > 0.05, `${source.id} lost its diagonal`).toBe(true);
      }
    }
  });

  it('carries identity through save and reload', () => {
    const saved = buildSavedCircuit(layout, null);
    expect(saved.components.map((c) => `${c.id}:${c.value}`))
      .toEqual(layout.components.map((c) => `${c.id}:${c.value}`));

    const overrides = overridesFromSavedCircuit(saved);
    const reloaded = rerouteLayout(layout, overrides.nodeEdits, overrides.wireEdits);
    for (const before of layout.components) {
      const after = reloaded.components.find((c) => c.id === before.id);
      expect(after.value).toBe(before.value);
      expect(after.terminals.map((t) => `${t.label}@${t.node}:${t.x},${t.y}`))
        .toEqual(before.terminals.map((t) => `${t.label}@${t.node}:${t.x},${t.y}`));
    }
  });
});

describe('source polarity', () => {
  const plusDirection = (c) => {
    const rad = (c.angle * Math.PI) / 180;
    return { x: -Math.cos(rad), y: -Math.sin(rad) };
  };
  const towardTerminal = (c, which) => {
    const x = which === 0 ? c.x1 : c.x2;
    const y = which === 0 ? c.y1 : c.y2;
    const dx = x - c.center.x;
    const dy = y - c.center.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };

  const sourceFixture = (labels) => ({
    contains_circuit: true,
    components: [
      angled('S1', 'battery', '9 V', 0.2, 0.5, 90, 0.05, labels),
      angled('P1', 'resistor', '10 Ω', 0.5, 0.4, 0, 0.06),
      angled('P2', 'resistor', '20 Ω', 0.5, 0.6, 0, 0.06),
    ],
    connections: [
      conn('S1', labels[0], 'P1', 'A'),
      conn('P1', 'B', 'P2', 'A'),
      conn('P2', 'B', 'S1', labels[1]),
    ],
  });

  it('puts the + plate on the + terminal whichever terminal it is', () => {
    for (const [labels, index] of [[['+', '−'], 0], [['−', '+'], 1]]) {
      const layout = layoutCircuit(sourceFixture(labels));
      const source = layout.components.find((c) => c.id === 'S1');
      expect(source.posTerminal).toBe(index === 0 ? 'A' : 'B');
      const plus = plusDirection(source);
      const target = towardTerminal(source, index);
      expect(plus.x * target.x + plus.y * target.y).toBeGreaterThan(0.9);
    }
  });

  it('reads polarity from worded labels too', () => {
    const layout = layoutCircuit(sourceFixture(['negative', 'positive']));
    const source = layout.components.find((c) => c.id === 'S1');
    expect(source.posTerminal).toBe('B');
    const plus = plusDirection(source);
    const target = towardTerminal(source, 1);
    expect(plus.x * target.x + plus.y * target.y).toBeGreaterThan(0.9);
  });

  it('keeps the two source terminals on distinct nodes', () => {
    const layout = layoutCircuit(sourceFixture(['+', '−']));
    const source = layout.components.find((c) => c.id === 'S1');
    expect(source.nodeA).not.toBe(source.nodeB);
    expect(source.terminals[0].node).not.toBe(source.terminals[1].node);
  });
});

describe('labels stay attached to the component they name', () => {
  const layout = layoutCircuit(crowded);

  it('never covers another component symbol', () => {
    for (const comp of layout.components) {
      for (const other of layout.components) {
        if (other.id === comp.id) continue;
        expect(
          overlaps(comp.labelBox, other.symbolBox),
          `${comp.id} label covers ${other.id}`,
        ).toBe(false);
      }
    }
  });

  it('never covers another label card', () => {
    const comps = layout.components;
    for (let i = 0; i < comps.length; i += 1) {
      for (let j = i + 1; j < comps.length; j += 1) {
        expect(
          overlaps(comps[i].labelBox, comps[j].labelBox),
          `${comps[i].id} label overlaps ${comps[j].id} label`,
        ).toBe(false);
      }
    }
  });

  it('stays within a card of its own drawn part', () => {
    for (const comp of layout.components) {
      expect(boxDist(comp.labelBox, comp.drawBox), `${comp.id} label drifted away`)
        .toBeLessThanOrEqual(16);
    }
  });

  it('keeps the label with the same value when a part is edited', () => {
    const before = layout.components.find((c) => c.id === 'P1');
    const moved = rerouteLayout(layout).components.find((c) => c.id === 'P1');
    expect(moved.value).toBe(before.value);
    expect(moved.terminals.map((t) => t.label)).toEqual(before.terminals.map((t) => t.label));
    expect(moved.labelPosition).toBeTruthy();
  });
});

describe('terminal-to-node consistency in the drawn result', () => {
  it('never joins two terminals of one part into one node', () => {
    const layout = layoutCircuit(crowded);
    for (const comp of layout.components) {
      expect(comp.nodeA, `${comp.id} shorted`).not.toBe(comp.nodeB);
    }
  });

  it('keeps the symbol axis aligned with its terminals at any angle', () => {
    const layout = layoutCircuit(crowded);
    for (const comp of layout.components) {
      const angle = symbolAngle(comp.axis, comp.terminals);
      const drawn = ((angle % 360) + 360) % 360;
      const own = ((comp.angle % 360) + 360) % 360;
      expect(Math.abs(drawn - own)).toBeLessThan(0.001);
    }
  });
});
