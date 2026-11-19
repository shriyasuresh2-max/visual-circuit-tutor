/**
 * Evidence-preserving reconstruction.
 *
 * Every fixture here describes a *shape*, not a picture: it states only the
 * relationships the rule under test depends on (two terminals meeting on a
 * node, a dot that names part of it, a span shorter than a symbol, a body that
 * disagrees with its own junctions). Nothing is written in terms of a
 * particular circuit, so the rules are proven on arbitrary layouts rather than
 * on one diagram.
 *
 * The two rules under test:
 *   - an extracted junction dot anchors its node whenever its valid component
 *     members all resolve to that node, however many of them it names;
 *   - a terminal the image reported is evidence: the drawn body shrinks to fit
 *     between the terminals instead of the terminals moving to fit the body,
 *     and geometry that contradicts itself is reported, never "corrected".
 */

import { describe, it, expect } from 'vitest';
import { layoutSchematic, rerouteLayout } from './schematicLayout.js';

// Mirrors the layout's padded canvas projection, so a test can state exactly
// where an extracted coordinate must land.
const PAD = 72;
const project = (p, bounds) => ({
  x: PAD + p.x * (bounds.width - 2 * PAD),
  y: PAD + p.y * (bounds.height - 2 * PAD),
});
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, tolerance = 1) => Math.abs(a - b) <= tolerance;

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

const terminalOf = (layout, compId, label) => {
  const comp = layout.components.find((c) => c.id === compId);
  const terminal = comp.terminals.find((t) => t.label === label);
  return { x: terminal.x, y: terminal.y, node: terminal.node };
};
const nodeFor = (layout, terminalKey) => {
  const [compId, label] = terminalKey.split('.');
  return terminalOf(layout, compId, label).node;
};

/**
 * Three terminals on one node, and the image drew its dot where only two of
 * them meet. The third lead arrives later in the drawing, so the dot is a real
 * joint on the node's conductor and must not be discarded.
 */
const railWithPartialDot = {
  contains_circuit: true,
  circuit_type: 'parallel',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.12, 0.30], ['−', 0.12, 0.70]),
    geo('R1', 'resistor', '4 Ω', ['A', 0.55, 0.20], ['B', 0.55, 0.36]),
    geo('R2', 'resistor', '6 Ω', ['A', 0.55, 0.64], ['B', 0.55, 0.80]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'),
    conn('V1', '+', 'R2', 'A'),
    conn('V1', '−', 'R1', 'B'),
    conn('V1', '−', 'R2', 'B'),
  ],
  junctions: [
    { id: 'J1', position: { x: 0.35, y: 0.15 }, members: ['R1.A', 'R2.A'] },
    { id: 'J2', position: { x: 0.35, y: 0.85 }, members: ['R1.B', 'R2.B'] },
  ],
  image_width: 1000,
  image_height: 700,
};

describe('extracted junction dots as node anchors', () => {
  it('anchors a three-member node from a dot naming only two of its terminals', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const nodeId = nodeFor(layout, 'R1.A');
    const node = layout.nodes.find((n) => n.id === nodeId);

    expect(node.anchorSource).toBe('extracted-junction');
    // The dot the image drew, not a centroid of the terminals.
    const dot = project({ x: 0.35, y: 0.15 }, layout.bounds);
    const centroid = {
      x: (terminalOf(layout, 'V1', '+').x + terminalOf(layout, 'R1', 'A').x + terminalOf(layout, 'R2', 'A').x) / 3,
      y: (terminalOf(layout, 'V1', '+').y + terminalOf(layout, 'R1', 'A').y + terminalOf(layout, 'R2', 'A').y) / 3,
    };
    expect(dist({ x: node.x, y: node.y }, dot)).toBeLessThan(dist(centroid, dot) / 2);
  });

  it('keeps the drawn junction dot where the node anchor is', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const nodeId = nodeFor(layout, 'R1.A');
    const node = layout.nodes.find((n) => n.id === nodeId);
    const drawn = layout.junctions.filter((j) => j.nodeId === nodeId);

    expect(drawn.length).toBe(1);
    expect(drawn[0].x).toBe(node.x);
    expect(drawn[0].y).toBe(node.y);
  });

  it('ignores trace-end members when judging membership', () => {
    const withTrace = {
      ...railWithPartialDot,
      junctions: [
        { id: 'J1', position: { x: 0.35, y: 0.15 }, members: ['R1.A', 'R2.A', 'W1.to'] },
        { id: 'J2', position: { x: 0.35, y: 0.85 }, members: ['R1.B', 'R2.B'] },
      ],
    };
    const layout = layoutSchematic(withTrace);
    const node = layout.nodes.find((n) => n.id === nodeFor(layout, 'R1.A'));

    expect(node.anchorSource).toBe('extracted-junction');
  });

  it('ignores members that are not terminals of this circuit at all', () => {
    const withNoise = {
      ...railWithPartialDot,
      junctions: [
        { id: 'J1', position: { x: 0.35, y: 0.15 }, members: ['R1.A', 'R2.A', 'corner', 'W2'] },
        { id: 'J2', position: { x: 0.35, y: 0.85 }, members: ['R1.B', 'R2.B'] },
      ],
    };
    const layout = layoutSchematic(withNoise);
    const node = layout.nodes.find((n) => n.id === nodeFor(layout, 'R1.A'));

    expect(node.anchorSource).toBe('extracted-junction');
  });

  it('refuses a dot whose terminals belong to different nodes', () => {
    const contradictory = {
      ...railWithPartialDot,
      junctions: [
        // R1.A and R1.B are on different nodes: the dot claims a joint that
        // cannot exist, so it is not evidence for either node.
        { id: 'J1', position: { x: 0.35, y: 0.15 }, members: ['R1.A', 'R1.B'] },
        { id: 'J2', position: { x: 0.35, y: 0.85 }, members: ['R1.B', 'R2.B'] },
      ],
    };
    const layout = layoutSchematic(contradictory);
    const node = layout.nodes.find((n) => n.id === nodeFor(layout, 'R1.A'));

    expect(node.anchorSource).not.toBe('extracted-junction');
  });

  it('draws a dot beyond its members as the point they hang off', () => {
    // Three terminals in a row on one node, and the image put its joint past the
    // last of them. The joint is the corner they reach, so the wires must
    // converge on it rather than chain the terminals and leave a dead-end spur.
    const corner = {
      contains_circuit: true,
      circuit_type: 'parallel',
      components: [
        geo('A1', 'resistor', '1 Ω', ['A', 0.20, 0.30], ['B', 0.55, 0.50]),
        geo('A2', 'resistor', '2 Ω', ['A', 0.20, 0.70], ['B', 0.60, 0.50]),
        geo('A3', 'resistor', '3 Ω', ['A', 0.20, 0.50], ['B', 0.58, 0.50]),
      ],
      connections: [
        conn('A1', 'B', 'A2', 'B'),
        conn('A2', 'B', 'A3', 'B'),
        conn('A1', 'A', 'A3', 'A'),
        conn('A2', 'A', 'A3', 'A'),
      ],
      junctions: [
        { id: 'JX', position: { x: 0.85, y: 0.50 }, members: ['A1.B', 'A2.B', 'A3.B'] },
      ],
      image_width: 1000,
      image_height: 700,
    };
    const layout = layoutSchematic(corner);
    const node = layout.nodes.find((n) => n.id === nodeFor(layout, 'A1.B'));
    const dot = project({ x: 0.85, y: 0.5 }, layout.bounds);

    expect(node.anchorSource).toBe('extracted-junction');
    expect(dist({ x: node.x, y: node.y }, dot)).toBeLessThanOrEqual(2);

    const nodeWires = layout.wires.filter((w) => w.node === node.id);
    const touchesDot = nodeWires.some((w) =>
      w.points.some((p) => dist(p, { x: node.x, y: node.y }) <= 2));
    expect(touchesDot, 'the drawn joint is reached by its own node').toBe(true);
    // Every member terminal is still drawn connected.
    for (const key of ['A1.B', 'A2.B', 'A3.B']) {
      const [id, label] = key.split('.');
      const t = terminalOf(layout, id, label);
      const touched = nodeWires.some((w) =>
        w.points.some((p) => dist(p, { x: t.x, y: t.y }) <= 2));
      expect(touched, `${key} is drawn connected`).toBe(true);
    }
  });

  it('never merges nodes because two dots sit close together', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const top = nodeFor(layout, 'R1.A');
    const bottom = nodeFor(layout, 'R1.B');
    expect(top).not.toBe(bottom);
    expect(layout.nodes.length).toBe(2);
  });
});

describe('extracted terminal coordinates', () => {
  it('keeps the reported terminals exactly and shrinks the body to fit', () => {
    const layout = layoutSchematic(railWithPartialDot);
    for (const id of ['R1', 'R2']) {
      const comp = layout.components.find((c) => c.id === id);
      const spec = railWithPartialDot.components.find((c) => c.id === id);
      expect(comp.lengthSource).toBe('extracted');
      expect(comp.lengthApproximate).toBe(false);
      spec.terminals.forEach((t, i) => {
        const expected = project(t.position, layout.bounds);
        expect(near(comp.terminals[i].x, expected.x), `${id}.${t.label} x`).toBe(true);
        expect(near(comp.terminals[i].y, expected.y), `${id}.${t.label} y`).toBe(true);
      });
      // The body is never longer than the terminals it sits between.
      expect(comp.symbolHalf * 2).toBeLessThanOrEqual(comp.halfSpan * 2 + 0.5);
      expect(comp.symbolScale).toBeGreaterThan(0);
      expect(comp.symbolScale).toBeLessThanOrEqual(1);
    }
  });

  it('compresses only the length of a body the image drew short', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const comp = layout.components.find((c) => c.id === 'R1');
    // A resistor's design half-length is 26; this one reports ~24 px per side.
    expect(comp.halfSpan).toBeLessThan(26);
    expect(comp.symbolHalf).toBeLessThan(26);
    expect(comp.symbolScale).toBeLessThan(1);
    // The height of the glyph, and therefore its legibility, is untouched: only
    // the length between the body's ends follows the reported span.
    expect(comp.symbolPerp).toBe(10);
  });

  it('preserves relative lengths instead of normalising every part', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const r1 = layout.components.find((c) => c.id === 'R1');
    const r2 = layout.components.find((c) => c.id === 'R2');
    // Both resistors report the same extracted length, so they draw the same.
    expect(Math.abs(r1.halfSpan - r2.halfSpan)).toBeLessThanOrEqual(1);
    expect(Math.abs(r1.symbolHalf - r2.symbolHalf)).toBeLessThanOrEqual(1);
  });

  it('falls back to the minimum span when the reported length cannot hold a symbol', () => {
    const tiny = {
      contains_circuit: true,
      circuit_type: 'series',
      components: [
        geo('V1', 'battery', '9 V', ['+', 0.20, 0.49], ['−', 0.20, 0.51]),
        geo('R1', 'resistor', '4 Ω', ['A', 0.60, 0.40], ['B', 0.60, 0.60]),
      ],
      connections: [conn('V1', '+', 'R1', 'A'), conn('V1', '−', 'R1', 'B')],
      image_width: 1000,
      image_height: 700,
    };
    const layout = layoutSchematic(tiny);
    const battery = layout.components.find((c) => c.id === 'V1');
    const resistor = layout.components.find((c) => c.id === 'R1');

    expect(battery.lengthSource).toBe('short-extracted');
    expect(battery.lengthApproximate).toBe(true);
    expect(battery.halfSpan * 2).toBeGreaterThan(40);
    expect(resistor.lengthSource).toBe('extracted');
    // The approximation is reported, not silent.
    expect(layout.geometryNotes.join(' ')).toContain('V1');
    expect(layout.renderValidation.warnings.join(' ')).toContain('V1');
  });
});

describe('contradictory geometry', () => {
  /**
   * R1's own terminals run horizontally while the two junction dots it joins
   * lie on a diagonal. Both are extracted evidence and they disagree, so the
   * component is kept exactly as extracted and reported as uncertain.
   */
  const contradictory = {
    contains_circuit: true,
    circuit_type: 'series',
    components: [
      geo('R1', 'resistor', '5 Ω', ['A', 0.50, 0.40], ['B', 0.70, 0.40]),
      geo('R2', 'resistor', '5 Ω', ['A', 0.30, 0.55], ['B', 0.45, 0.70]),
    ],
    connections: [conn('R1', 'A', 'R2', 'A'), conn('R1', 'B', 'R2', 'B')],
    junctions: [
      { id: 'J1', position: { x: 0.20, y: 0.15 }, members: ['R1.A', 'R2.A'] },
      { id: 'J2', position: { x: 0.85, y: 0.85 }, members: ['R1.B', 'R2.B'] },
    ],
    image_width: 1000,
    image_height: 700,
  };

  it('marks the disagreement without moving the component', () => {
    const layout = layoutSchematic(contradictory);
    const r1 = layout.components.find((c) => c.id === 'R1');
    const spec = contradictory.components[0];

    expect(r1.geometryUncertain).toBe(true);
    spec.terminals.forEach((t, i) => {
      const expected = project(t.position, layout.bounds);
      expect(near(r1.terminals[i].x, expected.x)).toBe(true);
      expect(near(r1.terminals[i].y, expected.y)).toBe(true);
    });
    // Orientation still comes from the terminals the image reported.
    expect(r1.axis.y).toBe(0);
  });

  it('does not flag a component whose terminals agree with its junctions', () => {
    const layout = layoutSchematic(contradictory);
    const r2 = layout.components.find((c) => c.id === 'R2');
    expect(r2.geometryUncertain).toBe(false);
  });

  it('reports the disagreement as a render warning', () => {
    const layout = layoutSchematic(contradictory);
    expect(layout.geometryNotes.join(' ')).toContain('R1');
    expect(layout.renderValidation.warnings.join(' ')).toContain('R1');
  });

  it('keeps connectivity unchanged when geometry is uncertain', () => {
    const layout = layoutSchematic(contradictory);
    expect(nodeFor(layout, 'R1.A')).toBe(nodeFor(layout, 'R2.A'));
    expect(nodeFor(layout, 'R1.B')).toBe(nodeFor(layout, 'R2.B'));
    expect(nodeFor(layout, 'R1.A')).not.toBe(nodeFor(layout, 'R1.B'));
    expect(layout.renderValidation.isValid).toBe(true);
  });
});

describe('generated wires follow the preserved terminals', () => {
  it('starts and ends every wire on a terminal or a node anchor', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const terminals = [];
    for (const c of layout.components) for (const t of c.terminals) terminals.push({ x: t.x, y: t.y });
    expect(layout.wires.length).toBeGreaterThan(0);
    for (const wire of layout.wires) {
      for (const point of [wire.points[0], wire.points[wire.points.length - 1]]) {
        const onTerminal = terminals.some((t) => dist(t, point) <= 2);
        const onAnchor = layout.nodes.some((n) => dist({ x: n.x, y: n.y }, point) <= 2);
        const openStub = String(wire.to || '').startsWith('OPEN:');
        expect(onTerminal || onAnchor || openStub, `wire ${wire.id} endpoint ${point.x},${point.y}`).toBe(true);
      }
    }
  });

  it('leaves terminals and anchors untouched when nothing was edited', () => {
    const layout = layoutSchematic(railWithPartialDot);
    const rerouted = rerouteLayout(layout);
    for (const comp of layout.components) {
      const after = rerouted.components.find((c) => c.id === comp.id);
      expect(after.terminals.map((t) => [t.x, t.y])).toEqual(comp.terminals.map((t) => [t.x, t.y]));
      expect(after.symbolHalf).toBe(comp.symbolHalf);
    }
    for (const node of layout.nodes) {
      const after = rerouted.nodes.find((n) => n.id === node.id);
      expect([after.x, after.y]).toEqual([node.x, node.y]);
      expect(after.anchorSource).toBe(node.anchorSource);
    }
    expect(rerouted.renderValidation.isValid).toBe(true);
  });
});

/**
 * Three parts, three span regimes: a resistor with room to spare, a diagonal
 * resistor the image drew shorter than its own body, and a source drawn shorter
 * than its plates. The fixture states spans, not a circuit: no part is a
 * special case, and the rules must hold for whatever an upload reports.
 */
const mixedSpans = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.12, 0.477], ['−', 0.12, 0.523]),
    geo('R1', 'resistor', '4 Ω', ['A', 0.45, 0.30], ['B', 0.45, 0.75]),
    geo('R2', 'resistor', '6 Ω', ['A', 0.30, 0.30], ['B', 0.36, 0.3745]),
  ],
  connections: [],
  junctions: [],
  wires: [],
  image_width: 1000,
  image_height: 700,
};

/**
 * A node drawn as a star: the image put a dot above two arms, so each arm
 * reaches it in one straight run. This is the shape a bridge is drawn with.
 */
const starNode = {
  contains_circuit: true,
  circuit_type: 'mixed',
  components: [
    geo('V1', 'battery', '9 V', ['+', 0.5, 0.18], ['−', 0.5, 0.86]),
    geo('R1', 'resistor', '4 Ω', ['A', 0.2, 0.5], ['B', 0.2, 0.66]),
    geo('R2', 'resistor', '6 Ω', ['A', 0.8, 0.5], ['B', 0.8, 0.66]),
  ],
  connections: [
    conn('V1', '+', 'R1', 'A'),
    conn('V1', '+', 'R2', 'A'),
    conn('R1', 'B', 'V1', '−'),
    conn('R2', 'B', 'V1', '−'),
  ],
  junctions: [
    { id: 'J1', position: { x: 0.5, y: 0.3 }, members: ['V1.+', 'R1.A', 'R2.A'] },
    { id: 'J2', position: { x: 0.5, y: 0.8 }, members: ['R1.B', 'R2.B', 'V1.−'] },
  ],
  image_width: 1000,
  image_height: 700,
};

describe('readable bodies for short extracted spans', () => {
  it('draws a body that fits comfortably between its terminals at design size', () => {
    const layout = layoutSchematic(mixedSpans);
    const r1 = layout.components.find((c) => c.id === 'R1');

    expect(r1.lengthSource).toBe('extracted');
    expect(r1.symbolHalf).toBe(26);
    expect(r1.symbolScale).toBe(1);
    expect(r1.bodyOverhang).toBe(false);
    // The body ends inside its terminals, so a lead joins each end to its
    // terminal rather than the glyph reaching past it.
    expect(r1.halfSpan - r1.symbolHalf).toBeGreaterThan(1);
  });

  it('keeps a short component readable instead of shrinking it proportionally', () => {
    const layout = layoutSchematic(mixedSpans);
    const r2 = layout.components.find((c) => c.id === 'R2');

    expect(r2.lengthSource).toBe('extracted');
    expect(r2.halfSpan).toBeLessThan(26);
    // The glyph keeps the full height of a resistor, which is what makes the
    // teeth legible; only its length follows the span, down to a readable floor.
    expect(r2.symbolPerp).toBe(10);
    expect(r2.symbolScale).toBeGreaterThanOrEqual(0.85 - 1e-6);
    expect(r2.symbolHalf).toBeGreaterThan(r2.halfSpan - 0.5);
    // A body longer than the gap between its terminals is reported, not hidden.
    expect(r2.symbolHalf).toBeGreaterThan(r2.halfSpan);
    expect(r2.bodyOverhang).toBe(true);
    expect(layout.geometryNotes.some((n) => n.includes('R2') && n.includes('readable'))).toBe(true);
  });

  it('keeps extracted terminals exactly, including on a short diagonal part', () => {
    const layout = layoutSchematic(mixedSpans);
    const r2 = layout.components.find((c) => c.id === 'R2');
    const expectedA = project({ x: 0.30, y: 0.30 }, layout.bounds);
    const expectedB = project({ x: 0.36, y: 0.3745 }, layout.bounds);
    const a = terminalOf(layout, 'R2', 'A');
    const b = terminalOf(layout, 'R2', 'B');

    expect(near(a.x, expectedA.x) && near(a.y, expectedA.y)).toBe(true);
    expect(near(b.x, expectedB.x) && near(b.y, expectedB.y)).toBe(true);
    // The glyph still lies on the terminals' own direction, so the diagonal is
    // preserved even though the body is longer than the gap.
    const drawn = (Math.atan2(r2.axis.y, r2.axis.x) * 180) / Math.PI;
    const reported = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // Terminals round to whole canvas units, which is worth ~1.5° on a span
    // this short; the direction itself is unchanged.
    expect(Math.abs(drawn - reported)).toBeLessThan(2);
  });

  it('keeps a short source legible and keeps its polarity', () => {
    const layout = layoutSchematic(mixedSpans);
    const v1 = layout.components.find((c) => c.id === 'V1');
    const plus = terminalOf(layout, 'V1', '+');
    const minus = terminalOf(layout, 'V1', '−');

    // A source's plates are its readable extent: they are not squashed just
    // because the reported span is short.
    expect(v1.symbolPerp).toBe(17);
    expect(v1.posTerminal).toBe('A');
    expect(near(plus.x, project({ x: 0.12, y: 0.477 }, layout.bounds).x)).toBe(true);
    expect(near(minus.y, project({ x: 0.12, y: 0.523 }, layout.bounds).y)).toBe(true);
  });

  it('keeps readable bodies clear of unrelated components', () => {
    const layout = layoutSchematic(mixedSpans);
    const boxes = layout.components.map((c) => ({ id: c.id, ...c.symbolBox }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    expect(layout.renderValidation.isValid).toBe(true);
  });

  it('draws a star node as straight spokes from the dot it was drawn at', () => {
    const layout = layoutSchematic(starNode);
    const node = layout.nodes.find((n) => n.members.includes('R1.A'));
    // The dot the image drew is the anchor, untouched.
    const dot = project({ x: 0.5, y: 0.3 }, layout.bounds);
    expect(near(node.x, dot.x, 1.5) && near(node.y, dot.y, 1.5)).toBe(true);
    // Each arm reaches the dot in one straight run. Bending it into two
    // axis-aligned segments is what turns a star of arms into a rectangle.
    for (const key of ['R1.A', 'R2.A']) {
      const wire = layout.wires.find((w) => w.from === key || w.to === key);
      expect(wire, `no wire joins ${key}`).toBeTruthy();
      expect(wire.points.length).toBe(2);
      expect(wire.isSpoke).toBe(true);
      // The terminal end is exactly the terminal the image reported.
      const terminal = terminalOf(layout, key.split('.')[0], key.split('.')[1]);
      const end = [wire.points[0], wire.points[1]].find((p) => near(p.x, terminal.x, 1) && near(p.y, terminal.y, 1));
      expect(end).toBeTruthy();
    }
  });

  it('puts every junction marker where conductors actually meet', () => {
    for (const fixture of [starNode, mixedSpans, railWithPartialDot]) {
      const layout = layoutSchematic(fixture);
      for (const marker of layout.junctions) {
        let ends = 0;
        let passes = 0;
        for (const wire of layout.wires) {
          if (wire.node !== marker.nodeId) continue;
          const last = wire.points.length - 1;
          wire.points.forEach((point, index) => {
            if (!near(point.x, marker.x, 2) || !near(point.y, marker.y, 2)) return;
            if (index === 0 || index === last) ends += 1;
            else passes += 1;
          });
        }
        const terminals = layout.components.reduce(
          (count, comp) => count + (comp.terminals || [])
            .filter((t) => near(t.x, marker.x, 2) && near(t.y, marker.y, 2)).length,
          0,
        );
        // Three conductors meeting, or a conductor running through while
        // another one joins it: a marker on either is a marker on a joint.
        const onBranch = ends + terminals >= 3 || (passes >= 1 && ends + terminals >= 2);
        expect(onBranch, `marker ${marker.id} at (${marker.x},${marker.y}) is on a plain run`).toBe(true);
      }
    }
  });

  it('keeps a readable body and its terminals through rerouting and reload', () => {
    const layout = layoutSchematic(mixedSpans);
    const rerouted = rerouteLayout(layout);
    for (const comp of layout.components) {
      const after = rerouted.components.find((c) => c.id === comp.id);
      expect(after.terminals.map((t) => [t.x, t.y])).toEqual(comp.terminals.map((t) => [t.x, t.y]));
      expect(after.symbolHalf).toBe(comp.symbolHalf);
      expect(after.symbolPerp).toBe(comp.symbolPerp);
      expect(after.symbolScale).toBe(comp.symbolScale);
      expect(after.bodyOverhang).toBe(comp.bodyOverhang);
      expect(after.posTerminal).toBe(comp.posTerminal);
    }
    // Moving a part keeps its size; only its position changes.
    const moved = layout.components.find((c) => c.id === 'R2');
    const edited = {
      ...layout,
      components: layout.components.map((c) =>
        c.id === 'R2' ? { ...c, center: { x: c.center.x, y: c.center.y + 30 }, terminals: c.terminals.map((t) => ({ ...t, y: t.y + 30 })) } : c,
      ),
    };
    const afterMove = rerouteLayout(edited).components.find((c) => c.id === 'R2');
    expect(afterMove.symbolHalf).toBe(moved.symbolHalf);
    expect(afterMove.symbolPerp).toBe(moved.symbolPerp);
    expect(afterMove.terminals.map((t) => t.y)).toEqual(moved.terminals.map((t) => t.y + 30));
  });
});
