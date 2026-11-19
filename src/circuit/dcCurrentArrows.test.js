import { describe, expect, it } from 'vitest';
import { placeDcCurrentArrows } from './dcCurrentArrows.js';

const point = (x, y) => ({ x, y });
const reference = {
  branchId: 'Load', componentId: 'Load',
  fromNodeId: 'up', toNodeId: 'down', fromTerminal: 'A', toTerminal: 'B',
};

function fixture() {
  return {
    bounds: { width: 330, height: 270 },
    nodes: [],
    junctions: [],
    components: [{
      id: 'Load',
      terminals: [{ ...point(100, 120), label: 'A', node: 'up' }, { ...point(160, 120), label: 'B', node: 'down' }],
      symbolBox: { minX: 105, maxX: 155, minY: 111, maxY: 129 },
      labelBox: { minX: 108, maxX: 150, minY: 76, maxY: 102 },
    }],
    allWires: [{ id: 'wire-out', node: 'down', from: 'Load.B', to: 'NODE:down',
      points: [point(160, 120), point(240, 120), point(240, 170)] }],
  };
}

function place(layout, mode, fields = {}) {
  return placeDcCurrentArrows(layout, {
    currentArrowMode: mode, currentDirections: [{ ...reference, ...fields }],
  }, {
    active: true, componentIds: new Set(['Load']),
    wireIds: new Set(layout.allWires.map(({ id }) => id)),
  });
}

describe('placeDcCurrentArrows', () => {
  it('uses reference orientation on a horizontal terminal leg even for a negative solved current', () => {
    const [arrow] = place(fixture(), 'reference', { signedCurrent: -2 });
    expect(arrow).toMatchObject({ mode: 'reference', wireId: 'wire-out', fromTerminal: 'A', toTerminal: 'B',
      label: { text: 'I_Load' } });
    expect(arrow.end.x).toBeGreaterThan(arrow.start.x);
    expect(arrow.end.y).toBe(arrow.start.y);
    expect(arrow.start.y).not.toBe(120);
  });

  it('keeps positive actual direction and reverses a negative actual direction', () => {
    const layout = fixture();
    const [positive] = place(layout, 'actual', { signedCurrent: 2 });
    const [negative] = place(layout, 'actual', { signedCurrent: -2 });
    expect(positive.end.x).toBeGreaterThan(positive.start.x);
    expect(negative.end.x).toBeLessThan(negative.start.x);
    expect(negative).toMatchObject({ mode: 'actual', fromTerminal: 'B', toTerminal: 'A', wireId: positive.wireId });
    expect(positive.flowPath.at(-1).x).toBeGreaterThan(positive.flowPath[0].x);
    expect(negative.flowPath).toEqual([...positive.flowPath].reverse());
  });

  it('omits exact and numerical zero in actual mode while allowing a reference arrow', () => {
    const layout = fixture();
    expect(place(layout, 'actual', { signedCurrent: 0 })).toEqual([]);
    expect(place(layout, 'actual', { signedCurrent: 1e-18, effectivelyZero: true })).toEqual([]);
    expect(place(layout, 'actual')).toEqual([]);
    expect(place(layout, 'reference', { signedCurrent: 0 })).toHaveLength(1);
    expect(place(layout, 'reference', { signedCurrent: 2 })[0].flowPath).toBeNull();
  });

  it('follows a vertical terminal segment even if stored wire order is reversed and later bends', () => {
    const layout = fixture();
    Object.assign(layout.allWires[0], {
      from: 'NODE:down', to: 'Load.B',
      points: [point(245, 207), point(160, 207), point(160, 120)],
    });
    const [arrow] = place(layout, 'actual', { signedCurrent: 1 });
    expect(arrow.wireId).toBe('wire-out');
    expect(arrow.start.x).toBe(arrow.end.x);
    expect(arrow.end.y).toBeGreaterThan(arrow.start.y);
  });

  it('does not put a branch arrow beyond a shared-net junction or on an ambiguous attachment', () => {
    const layout = fixture();
    layout.allWires.push({
      id: 'same-net-tee', node: 'down', from: 'Other.A', to: 'NODE:down',
      points: [point(171, 160), point(171, 120)],
    });
    const [besideComponent] = place(layout, 'reference');
    expect(besideComponent.wireId).toBeNull();
    layout.allWires[1].from = 'Load.B';
    layout.allWires[1].points = [point(160, 120), point(160, 180)];
    expect(place(layout, 'reference')[0].wireId).toBeNull();
    expect(place(layout, 'actual', { signedCurrent: 2 })[0].flowPath).toBeUndefined();
  });

  it('follows a clear bend, then stops before an intersecting run on the same net', () => {
    const layout = fixture();
    layout.allWires[0].points = [point(160, 120), point(202, 120), point(202, 210)];
    const [clear] = place(layout, 'actual', { signedCurrent: 1 });
    expect(clear.flowPath).toHaveLength(3);
    expect(clear.flowPath[1]).toEqual(point(202, 120));
    expect(clear.flowPath.at(-1).y).toBeGreaterThan(138);

    layout.allWires.push({
      id: 'branch-tee', node: 'down', from: 'Other.A', to: 'NODE:down',
      points: [point(235, 135), point(202, 135)],
    });
    const [clipped] = place(layout, 'actual', { signedCurrent: 1 });
    expect(clipped.flowPath[1]).toEqual(point(202, 120));
    expect(clipped.flowPath.at(-1).y).toBeLessThan(135);
  });

  it('stops before a known junction even when another wire does not name that point', () => {
    const layout = fixture();
    layout.junctions = [{ id: 'physical', nodeId: 'down', x: 203, y: 120, isRealJunction: true }];
    const [arrow] = place(layout, 'actual', { signedCurrent: 1 });
    expect(arrow.flowPath.at(-1).x).toBeLessThan(203);
  });

  it('leaves a static arrow if the corresponding wire leg is covered by a label', () => {
    const layout = fixture();
    layout.components[0].labelBox = { minX: 182, maxX: 224, minY: 119, maxY: 121 };
    const [arrow] = place(layout, 'actual', { signedCurrent: 1 });
    expect(arrow.wireId).toBe('wire-out');
    expect(arrow.flowPath.at(-1).x).toBeLessThan(182);
  });

  it('uses the other terminal when its verified lead is the only clear route for motion', () => {
    const layout = fixture();
    layout.components[0].labelBox = { minX: 161, maxX: 245, minY: 119, maxY: 121 };
    layout.allWires.push({
      id: 'wire-in', node: 'up', from: 'NODE:up', to: 'Load.A',
      points: [point(25, 120), point(100, 120)],
    });
    const [arrow] = place(layout, 'actual', { signedCurrent: 1 });
    expect(arrow.wireId).toBe('wire-in');
    expect(arrow.flowPath.at(-1).x).toBeGreaterThan(arrow.flowPath[0].x);
  });

  it('uses a verified body-side fallback when the drawn endpoint does not match its terminal', () => {
    const layout = fixture();
    layout.allWires[0].points[0] = point(172, 120);
    expect(place(layout, 'reference')[0].wireId).toBeNull();
    expect(place(layout, 'reference', { fromTerminal: 'missing' })).toEqual([]);
    expect(place(layout, 'reference', { toNodeId: 'wrong-net' })).toEqual([]);
    expect(place(layout, null)).toEqual([]);
    layout.renderValidation = { isValid: false };
    expect(place(layout, 'reference')).toEqual([]);
  });

  it('repositions an arrow after a geometry edit using the same electrical direction', () => {
    const layout = fixture();
    const [before] = place(layout, 'reference');
    const component = layout.components[0];
    for (const terminal of component.terminals) terminal.y += 25;
    for (const box of [component.symbolBox, component.labelBox]) {
      box.minY += 25;
      box.maxY += 25;
    }
    for (const point of layout.allWires[0].points) point.y += 25;
    const [after] = place(layout, 'reference');
    expect(after.start.y - before.start.y).toBe(25);
    expect(after.wireId).toBe(before.wireId);
    expect(after.end.x - after.start.x).toBe(before.end.x - before.start.x);
  });

  it('repositions the animated path when the actual wire layout changes', () => {
    const layout = fixture();
    const [before] = place(layout, 'actual', { signedCurrent: -2 });
    for (const p of [...layout.components[0].terminals, ...layout.allWires[0].points]) p.x += 20;
    const [after] = place(layout, 'actual', { signedCurrent: -2 });
    expect(after.flowPath).toEqual(before.flowPath.map(({ x, y }) => point(x + 20, y)));
  });

  it('omits an arrow when all nearby placements would cover a label', () => {
    const layout = fixture();
    layout.components[0].labelBox = { minX: 0, maxX: 330, minY: 0, maxY: 270 };
    expect(place(layout, 'reference')).toEqual([]);
  });
});
