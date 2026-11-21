import { describe, expect, it } from 'vitest';
import { solveDcCircuit } from './dcSolver.js';
import { solveDcSeriesParallel } from './dcSeriesParallelSolver.js';
import { buildGraph } from './electricalGraph.js';

const r = (id, a, b, value) => ({ id, a, b, type: 'resistor', value });
const v = (id, a, b, value) => ({ id, a, b, type: 'voltage_source', value });
const i = (id, a, b, value) => ({ id, a, b, type: 'current_source', value });

function graphOf(elements) {
  const groups = new Map();
  const components = elements.map(({ id, a, b, type, value }) => {
    const [first, last, unit] = type === 'voltage_source' ? ['+', '−', 'V']
      : ['A', 'B', type === 'current_source' ? 'A' : 'Ω'];
    for (const [node, label] of [[a, first], [b, last]]) {
      if (!groups.has(node)) groups.set(node, []);
      groups.get(node).push(`${id}.${label}`);
    }
    return {
      id, type, visible_value: typeof value === 'number' ? `${value} ${unit}` : value,
      terminals: [{ label: first }, { label: last }],
      ...(type === 'current_source' ? { currentDirection: { fromTerminal: first, toTerminal: last } } : {}),
    };
  });
  return buildGraph({ components, nodes: [...groups].map(([id, members]) => ({ id, members })) });
}

function verifySteps(result) {
  let topology = result.initialGraph;
  const treeNodes = new Map(result.reductionTree.roots.map((root) => [root.id, root]));
  const queue = [...treeNodes.values()];
  for (const root of queue) {
    for (const { tree } of root.members ?? []) {
      treeNodes.set(tree.id, tree);
      queue.push(tree);
    }
  }
  for (const step of result.steps) {
    const values = step.members.map(({ resistance }) => resistance);
    const calculated = step.operation === 'series'
      ? values.reduce((total, value) => total + value, 0)
      : 1 / values.reduce((total, value) => total + 1 / value, 0);
    expect(step.equivalentResistance).toBeCloseTo(calculated, 12);
    const prior = new Map(topology.branches.map((branch) => [branch.id, branch]));
    const after = new Map(step.topology.branches.map((branch) => [branch.id, branch]));
    const tree = treeNodes.get(step.id);
    expect(tree).toMatchObject({
      operation: step.operation, resistance: step.equivalentResistance,
      originalComponentIds: step.originalComponentIds, fromNodeId: step.fromNodeId, toNodeId: step.toNodeId,
    });
    expect(tree.members.map(({ sign, tree: child }) => [child.id, sign]))
      .toEqual(step.members.map(({ id, sign }) => [id, sign]));
    for (const member of step.members) {
      expect(prior.get(member.id)).toMatchObject({ resistance: member.resistance, type: 'resistor' });
      expect(after.has(member.id)).toBe(false);
    }
    const directed = step.members.map(({ fromNodeId, toNodeId, sign }) => sign > 0
      ? [fromNodeId, toNodeId] : [toNodeId, fromNodeId]);
    if (step.operation === 'series') {
      expect(directed).toEqual([[step.fromNodeId, step.sharedNodeId], [step.sharedNodeId, step.toNodeId]]);
      expect(topology.nodes.find(({ id }) => id === step.sharedNodeId).members).toHaveLength(2);
      expect(step.topology.nodes.some(({ id }) => id === step.sharedNodeId)).toBe(false);
    } else {
      expect(directed).toEqual(step.members.map(() => [step.fromNodeId, step.toNodeId]));
    }
    expect(after.get(step.id)).toMatchObject({
      fromNodeId: step.fromNodeId, toNodeId: step.toNodeId, resistance: step.equivalentResistance,
    });
    expect(step.topology.branches).toHaveLength(topology.branches.length - step.members.length + 1);
    topology = step.topology;
  }
  expect(result.remainingGraph).toEqual(topology);
}

function verifyComplete(graph, equivalentResistance, expectations) {
  const result = solveDcSeriesParallel(graph);
  expect(result.status, JSON.stringify(result.issues)).toBe('complete');
  expect(result.equivalentResistance).toBeCloseTo(equivalentResistance, 12);
  expect(result.reductionTree.roots).toHaveLength(1);
  verifySteps(result);
  const oracle = solveDcCircuit(graph, { referenceNodeId: result.source.toNodeId });
  expect(oracle.ok).toBe(true);
  const allResults = [...result.branches, result.source];
  const kcl = new Map(graph.nodes.map(({ id }) => [id, 0]));
  let power = 0;
  for (const resultBranch of allResults) {
    const { componentId, fromNodeId, toNodeId, current, voltage } = resultBranch;
    expect(current, componentId).toBeCloseTo(expectations[componentId], 10);
    const nodal = oracle.branches.find((branch) => branch.componentId === componentId);
    expect(voltage).toBeCloseTo(nodal.voltage, 10);
    expect(current).toBeCloseTo(nodal.current, 10);
    expect(resultBranch.power).toBeCloseTo(nodal.voltage * nodal.current, 10);
    kcl.set(fromNodeId, kcl.get(fromNodeId) + current);
    kcl.set(toNodeId, kcl.get(toNodeId) - current);
    power += resultBranch.power;
  }
  for (const sum of kcl.values()) expect(sum).toBeCloseTo(0, 10);
  expect(power).toBeCloseTo(0, 10);
  expect(result.backSubstitution).toHaveLength(result.steps.length);
  return result;
}

const bridge = [
  v('V', 'a', 'g', 10), r('R1', 'a', 'b', 1), r('R2', 'a', 'c', 2),
  r('R3', 'b', 'g', 2), r('R4', 'c', 'g', 1), r('R5', 'b', 'c', 2),
];

describe('DC series-parallel reduction', () => {
  it('adds series resistances and respects a reversed resistor', () => {
    const result = verifyComplete(graphOf([v('V', 'a', 'g', 12), r('R1', 'b', 'a', 2), r('R2', 'b', 'g', 4)]),
      6, { V: -2, R1: -2, R2: 2 });
    expect(result.steps.map(({ operation }) => operation)).toEqual(['series']);
    expect(result.branches[0]).toMatchObject({ componentId: 'R1', voltage: -4, power: 8 });
  });

  it('combines all parallel branches and avoids synthetic ID collisions', () => {
    const result = verifyComplete(graphOf([
      v('V', 'a', 'g', 12), r('equivalent-1', 'a', 'g', 6), r('R2', 'g', 'a', 12), r('R3', 'a', 'g', 4),
    ]), 2, { V: -6, 'equivalent-1': 2, R2: -1, R3: 3 });
    expect(result.steps[0]).toMatchObject({ operation: 'parallel', id: 'equivalent-2' });
    expect(result.steps[0].members).toHaveLength(3);
  });

  it('reduces nested and mixed groups with deterministic topology snapshots', () => {
    const graph = graphOf([
      v('V', 'a', 'g', 18), r('R1', 'a', 'b', 2), r('R2', 'b', 'd', 3), r('R3', 'd', 'c', 3),
      r('R4', 'c', 'b', 6), r('R5', 'c', 'g', 4),
    ]);
    const original = structuredClone(graph);
    const result = verifyComplete(graph, 9, { V: -2, R1: 2, R2: 1, R3: 1, R4: -1, R5: 2 });
    expect(result.steps.map(({ operation }) => operation)).toContain('parallel');
    expect(result.steps.at(-1).originalComponentIds).toEqual(['R1', 'R2', 'R3', 'R4', 'R5']);
    expect(graph).toEqual(original);
    expect(solveDcSeriesParallel({
      ...graph,
      components: [...graph.components].reverse().map((component) => ({ ...component, center: { x: 9, y: 5 } })),
      nodes: [...graph.nodes].reverse(),
    })).toEqual(result);
  });

  it('reconstructs a deeply nested chain from the last equivalent back to the original resistors', () => {
    const count = 32;
    const resistors = Array.from({ length: count }, (_, j) => r(`R${j}`, `p${j}`, `p${j + 1}`, 1));
    const result = verifyComplete(graphOf([v('V', 'p0', `p${count}`, 16), ...resistors]), count, {
      V: -0.5, ...Object.fromEntries(resistors.map(({ id }) => [id, 0.5])),
    });
    expect(result.steps).toHaveLength(count - 1);
  });

  it.each([-8, 0])('handles a single resistor and a source of %s volts without reduction steps', (voltage) => {
    const result = verifyComplete(graphOf([v('V', 'a', 'g', voltage), r('R', 'g', 'a', 4)]), 4,
      { V: -voltage / 4, R: -voltage / 4 });
    expect(result.steps).toEqual([]);
  });

  it('leaves an irreducible Wheatstone bridge intact', () => {
    const graph = graphOf(bridge);
    expect(solveDcCircuit(graph).ok).toBe(true);
    const result = solveDcSeriesParallel(graph);
    expect(result).toMatchObject({ status: 'unsupported', steps: [], issues: [{ code: 'network-not-reducible' }] });
    expect(result).not.toHaveProperty('equivalentResistance');
    expect(result.remainingGraph).toEqual(result.initialGraph);
  });

  it('reports valid local combinations in a bridge without inventing a total or branch solution', () => {
    const result = solveDcSeriesParallel(graphOf([...bridge, r('P', 'a', 'b', 1)]));
    expect(result.status).toBe('partial');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ operation: 'parallel', originalComponentIds: ['P', 'R1'] });
    expect(result.remainingGraph.nodes).toHaveLength(4);
    expect(result).not.toHaveProperty('equivalentResistance');
    expect(result).not.toHaveProperty('branches');
    verifySteps(result);
  });

  it('keeps current and voltage source terminals out of series combinations', () => {
    const result = solveDcSeriesParallel(graphOf([
      v('V', 'p', 'g', 8), i('I', 'g', 't', 2), r('R1', 'p', 't', 2), r('R2', 't', 'g', 2),
      r('R3', 'p', 'g', 2), r('R4', 'p', 'g', 4),
    ]));
    expect(result).toMatchObject({ status: 'partial', issues: [{ code: 'source-configuration' }] });
    expect(result.steps.map(({ originalComponentIds }) => originalComponentIds)).toEqual([['R3', 'R4']]);
    expect(result.remainingGraph.branches.filter(({ type }) => type !== 'resistor')).toHaveLength(2);
    verifySteps(result);
    const multiple = solveDcSeriesParallel(graphOf([v('V1', 'a', 'c', 5), v('V2', 'c', 'g', 3), r('R', 'a', 'g', 2)]));
    expect(multiple).toMatchObject({ status: 'unsupported', issues: [{ code: 'source-configuration' }] });
  });

  it('records local reductions in an unpowered resistor loop without solving it', () => {
    const result = solveDcSeriesParallel(graphOf([r('R1', 'a', 'b', 2), r('R2', 'b', 'c', 2), r('R3', 'c', 'a', 4)]));
    expect(result).toMatchObject({ status: 'partial', issues: [{ code: 'source-configuration' }] });
    expect(result).not.toHaveProperty('source');
    verifySteps(result);
  });

  it.each([0, '4 \u0300', null])('rejects zero, unreadable, or missing resistance %j', (value) => {
    const result = solveDcSeriesParallel(graphOf([v('V', 'a', 'g', 12), r('R', 'a', 'g', value)]));
    expect(result).toMatchObject({ status: 'invalid', issues: [{ componentId: 'R' }] });
  });

  it('rejects disconnected subnetworks and a shorted ideal voltage source', () => {
    const disconnected = solveDcSeriesParallel(graphOf([
      v('V', 'a', 'g', 8), r('R1', 'a', 'g', 4), r('R2', 'island-a', 'island-b', 3), r('R3', 'island-a', 'island-b', 5),
    ]));
    expect(disconnected).toMatchObject({ status: 'invalid', issues: [{ code: 'disconnected-network' }] });
    const shorted = solveDcSeriesParallel(graphOf([v('V', 'a', 'a', 5), r('R', 'a', 'a', 2)]));
    expect(shorted).toMatchObject({ status: 'invalid', issues: [{ code: 'shorted-voltage-source' }] });
  });

  it('does not reduce a resistor tied to one node or solve for unsupported component types', () => {
    const graph = graphOf([v('V', 'a', 'g', 6), r('Load', 'a', 'g', 2), r('Shunted', 'a', 'a', 1)]);
    const shunted = solveDcSeriesParallel(graph);
    expect(shunted).toMatchObject({ status: 'unsupported', steps: [] });
    expect(shunted).not.toHaveProperty('equivalentResistance');
    const capacitor = graph.components.find(({ id }) => id === 'Shunted');
    capacitor.type = 'capacitor';
    expect(solveDcSeriesParallel(graph)).toMatchObject({
      status: 'unsupported', issues: [{ code: 'unsupported-component', componentId: 'Shunted' }],
    });
  });
});
