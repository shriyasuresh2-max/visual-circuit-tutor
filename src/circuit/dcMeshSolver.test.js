import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { solveDcMeshCircuit } from './dcMeshSolver.js';

const r = (id, a, b, value) => ({ id, a, b, value, type: 'resistor', unit: 'Ω' });
const v = (id, a, b, value) => ({ id, a, b, value, type: 'voltage_source', unit: 'V' });
const i = (id, a, b, value, reverse = false) => ({ id, a, b, value, type: 'current_source', unit: 'A', reverse });

function graphOf(elements) {
  const groups = new Map();
  const components = elements.map(({ id, type, unit, value, a, b, reverse }) => {
    const labels = type === 'voltage_source' ? ['+', '−'] : ['A', 'B'];
    for (const [node, label] of [[a, labels[0]], [b, labels[1]]]) {
      if (!groups.has(node)) groups.set(node, []);
      groups.get(node).push(`${id}.${label}`);
    }
    return {
      id, type, visible_value: `${value} ${unit}`, terminals: labels.map((label) => ({ label })),
      ...(type === 'current_source' ? {
        currentDirection: { fromTerminal: reverse ? 'B' : 'A', toTerminal: reverse ? 'A' : 'B' },
      } : {}),
    };
  });
  return buildGraph({ components, nodes: [...groups].map(([id, members]) => ({ id, members })) });
}

function check(elements, expected, meshCount, graph = graphOf(elements)) {
  const result = solveDcMeshCircuit(graph);
  expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  expect(result.meshes).toHaveLength(meshCount);
  expect(result.meshes).toHaveLength(elements.length - graph.nodes.length + 1);
  const mna = solveDcCircuit(graph, { referenceNodeId: result.referenceNodeId });
  expect(mna.ok).toBe(true);
  const meshCurrent = new Map(result.meshes.map(({ id, current }) => [id, current]));
  const branchById = new Map(result.branches.map((branch) => [branch.componentId, branch]));
  const kcl = new Map(graph.nodes.map(({ id }) => [id, 0]));
  const items = new Map(elements.map((element) => [element.id, element]));
  for (const branch of result.branches) {
    const { componentId: id, current, voltage, fromNodeId, toNodeId, meshIncidence } = branch;
    const { type, value } = items.get(id);
    expect(current, id).toBeCloseTo(expected[id], 10);
    expect(current).toBeCloseTo(mna.branches.find((other) => other.componentId === id).current, 10);
    expect(voltage).toBeCloseTo(mna.branches.find((other) => other.componentId === id).voltage, 10);
    expect(meshIncidence.reduce((sum, { meshId, sign }) => sum + sign * meshCurrent.get(meshId), 0))
      .toBeCloseTo(current, 10);
    kcl.set(fromNodeId, kcl.get(fromNodeId) + current);
    kcl.set(toNodeId, kcl.get(toNodeId) - current);
    if (type === 'resistor') expect(voltage).toBeCloseTo(value * expected[id], 10);
    if (type === 'voltage_source') expect(voltage).toBeCloseTo(value, 10);
    if (type === 'current_source') expect(current).toBeCloseTo(value, 10);
  }
  for (const current of kcl.values()) expect(current).toBeCloseTo(0, 10);
  for (const { boundary } of [...result.meshes, { boundary: result.externalBoundary }]) {
    const voltageSum = boundary.reduce((sum, { componentId, sign }, index) => {
      const edge = boundary[index];
      expect(edge.toNodeId).toBe(boundary[(index + 1) % boundary.length].fromNodeId);
      const { type, value } = items.get(componentId);
      const drop = type === 'current_source' ? branchById.get(componentId).voltage
        : type === 'voltage_source' ? value : value * expected[componentId];
      return sum + sign * drop;
    }, 0);
    expect(voltageSum).toBeCloseTo(0, 10);
  }
  for (const { coefficients, rhs } of result.equations) {
    expect(coefficients).toHaveLength(meshCount);
    expect(coefficients.reduce((sum, coefficient, j) => sum + coefficient * result.meshes[j].current, 0))
      .toBeCloseTo(rhs, 10);
  }
  return result;
}

describe('planar mesh-current analysis', () => {
  it('solves a single loop with opposing independent voltage sources', () => {
    const result = check([v('V1', 'a', 'g', 10), v('V2', 'a', 'b', 4), r('R', 'b', 'g', 3)],
      { V1: -2, V2: 2, R: 2 }, 1);
    expect(result.equations[0]).toMatchObject({ kind: 'kvl', coefficients: [3], rhs: expect.any(Number) });
    expect(Math.abs(result.equations[0].rhs)).toBe(6);
  });

  it('produces two facial equations with a shared-resistor off-diagonal term', () => {
    const result = check([
      v('V', 'x', 'g', 12), r('R1', 'x', 'a', 3), r('R2', 'a', 'g', 6), r('R3', 'a', 'g', 6),
    ], { V: -2, R1: 2, R2: 1, R3: 1 }, 2);
    expect(result.equations[0].coefficients[1]).toBe(-6);
    expect(result.equations[1].coefficients[0]).toBe(-6);
    expect(result.branches.filter(({ meshIncidence }) => meshIncidence.length === 2)).toHaveLength(1);
  });

  it('solves three meshes in a planar multigraph of parallel components', () => {
    check([v('V', 'a', 'g', 12), r('R1', 'a', 'g', 6), r('R2', 'a', 'g', 4), r('R3', 'a', 'g', 3)],
      { V: -9, R1: 2, R2: 3, R3: 4 }, 3);
  });

  it('cancels a cut edge traversed twice by one face and retains both physical loops', () => {
    const result = check([
      v('V', 'a', 'b', 8), r('R1', 'a', 'b', 4), r('link', 'b', 'c', 3),
      r('R2', 'c', 'd', 2), r('R3', 'c', 'd', 2),
    ], { V: -2, R1: 2, link: 0, R2: 0, R3: 0 }, 2);
    expect(result.branches.find(({ componentId }) => componentId === 'link').meshIncidence).toEqual([]);
    const passes = [...result.meshes.flatMap(({ boundary }) => boundary), ...result.externalBoundary]
      .filter(({ componentId }) => componentId === 'link');
    expect(passes.map(({ sign }) => sign).sort()).toEqual([-1, 1]);
  });

  it('uses three bounded faces of an unbalanced bridge', () => {
    const elements = [
      v('V', 'a', 'g', 10), r('R1', 'a', 'b', 1), r('R2', 'a', 'c', 2), r('R3', 'b', 'g', 2),
      r('R4', 'c', 'g', 1), r('R5', 'b', 'c', 2),
    ];
    const expected = { V: -7, R1: 4, R2: 3, R3: 3, R4: 4, R5: 1 };
    const graph = graphOf(elements);
    const original = structuredClone(graph);
    const result = check(elements, expected, 3, graph);
    expect(graph).toEqual(original);
    const shuffled = {
      ...graph, nodes: [...graph.nodes].reverse().map((node) => ({ ...node, x: 3, y: -5 })),
      components: [...graph.components].reverse().map((component) => ({ ...component, center: { x: 0, y: 0 } })),
      wires: [{ points: [{ x: 10, y: 20 }] }],
    };
    expect(solveDcMeshCircuit(shuffled)).toEqual(result);
  });

  it.each([[2, false, 2], [2, true, -2], [-2, false, -2], [0, true, 0]])(
    'applies a single-mesh constraint for prescribed current %s (reversed: %s)',
    (value, reverse, load) => {
      const result = check([i('I', 'g', 'a', value, reverse), r('R', 'a', 'g', 4)], { I: value, R: load }, 1);
      expect(result.equations).toEqual([expect.objectContaining({
        kind: 'current-constraint', componentId: 'I', rhs: value,
      })]);
      expect(Math.abs(result.equations[0].coefficients[0])).toBe(1);
    },
  );

  it('writes supermesh KVL around a shared source and never includes that source’s drop in the equation', () => {
    const result = check([
      i('I', 'g', 'a', 2), r('L1', 'a', 'l', 2), r('L2', 'l', 'g', 2),
      r('R1', 'a', 'r', 3), r('R2', 'r', 'g', 3),
    ], { I: 2, L1: 1.2, L2: 1.2, R1: 0.8, R2: 0.8 }, 2);
    const constraint = result.equations.find(({ kind }) => kind === 'current-constraint');
    expect([...constraint.coefficients].sort()).toEqual([-1, 1]);
    const supermesh = result.equations.find(({ kind }) => kind === 'supermesh-kvl');
    expect(supermesh.meshIds).toHaveLength(2);
    expect(supermesh.branchTerms.map(({ componentId }) => componentId)).toEqual(['L1', 'L2', 'R1', 'R2']);
  });

  it('combines multiple prescribed source currents with a voltage source in a larger supermesh', () => {
    check([
      i('I1', 'g', 'a', 2), i('I2', 'g', 'a', 1, true), v('V', 'x', 'g', 6),
      r('R1', 'x', 'a', 2), r('R2', 'a', 'g', 4),
    ], { I1: 2, I2: 1, V: -1 / 3, R1: 1 / 3, R2: 4 / 3 }, 3);
  });

  it('rejects nonplanar K3,3 even though its resistive DC solution exists', () => {
    const edges = ['a', 'b', 'c'].flatMap((left) =>
      ['x', 'y', 'z'].map((right) => r(left + right, left, right, 2)));
    const graph = graphOf(edges);
    expect(solveDcCircuit(graph).ok).toBe(true);
    expect(solveDcMeshCircuit(graph)).toMatchObject({ ok: false, issues: [{ code: 'unsupported-method', reason: 'nonplanar' }] });
  });

  it('rejects invalid inputs, contradictory and redundant voltage sources, and undetermined voltages', () => {
    expect(solveDcMeshCircuit(graphOf([r('R', 'a', 'b', 0)])))
      .toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid-resistance' })]) });
    for (const [value, code] of [[3, 'singular-system'], [4, 'inconsistent-system']]) {
      expect(solveDcMeshCircuit(graphOf([v('V1', 'a', 'g', 3), v('V2', 'a', 'g', value)])))
        .toMatchObject({ ok: false, issues: [{ code }] });
    }
    for (const [value, code] of [[2, 'singular-system'], [1, 'inconsistent-system']]) {
      expect(solveDcMeshCircuit(graphOf([i('I1', 'a', 'g', 2), i('I2', 'g', 'a', value)])))
        .toMatchObject({ ok: false, issues: [{ code }] });
    }
  });
});
