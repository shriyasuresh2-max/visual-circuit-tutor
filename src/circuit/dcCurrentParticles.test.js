import { describe, expect, it } from 'vitest';
import series from '../../tests/fixtures/sample_extracted_analysis.json';
import parallel from '../../tests/fixtures/mixed_return_trace_analysis.json';
import mixedSources from '../../tests/fixtures/dc_mesh_tutor_analysis.json';
import currentSource from '../../tests/fixtures/dc_current_source_analysis.json';
import { buildGraph } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { solveDcCircuit } from './dcSolver.js';
import { solveDcMeshCircuit } from './dcMeshSolver.js';
import { solveDcSeriesParallel } from './dcSeriesParallelSolver.js';
import { buildDcLesson } from './dcLesson.js';
import { buildDcMeshLesson } from './dcMeshLesson.js';
import { buildDcSeriesParallelLesson } from './dcSeriesParallelLesson.js';
import { dcParticleDuration, mapDcCurrentParticles, stitchResistorParticleRuns } from './dcCurrentParticles.js';
import { resistorGeometry } from './resistorGeometry.js';

function setup(capture) {
  const graph = buildGraph(capture);
  const layout = layoutCircuit(capture, graph);
  const result = solveDcCircuit(graph);
  expect(result.ok).toBe(true);
  const step = { currentArrowMode: 'actual', branchFlows: result.branches };
  return { graph, layout, step, runs: mapDcCurrentParticles(graph, layout, step) };
}

const samePoint = (a, b) => a.x === b.x && a.y === b.y;

function checkTerminalFlows(layout, step, runs) {
  for (const branch of step.branchFlows) {
    const { terminals } = layout.components.find(({ id }) => id === branch.componentId);
    for (const [label, inject] of [[branch.fromTerminal, -branch.current], [branch.toTerminal, branch.current]]) {
      const terminal = terminals.find((t) => t.label === label);
      const sameNet = runs.filter(({ nodeId }) => nodeId === terminal.node);
      const outgoing = sameNet.filter(({ points }) => samePoint(points[0], terminal));
      const incoming = sameNet.filter(({ points }) => samePoint(points.at(-1), terminal));
      const actual = [...outgoing.map(({ amperes }) => amperes), ...incoming.map(({ amperes }) => -amperes)]
        .reduce((sum, amps) => sum + amps, 0);
      expect(actual).toBeCloseTo(inject, 10);
    }
  }
}

describe('verified moving current paths', () => {
  it.each(['12 V', '-12 V', '0 V'])('uses signed currents in a loop supplied at %s', (value) => {
    const capture = { ...series, components: series.components.map((c) =>
      c.type === 'resistor' ? c : { ...c, visible_value: value }) };
    const { layout, step, runs } = setup(capture);
    expect(runs).toHaveLength(value === '0 V' ? 0 : 2);
    checkTerminalFlows(layout, step, runs);
    if (runs.length) expect(runs.some(({ points }) => points.length >= 3)).toBe(true);
  });

  it('splits and merges parallel currents on the same net while conserving each junction', () => {
    const { layout, step, runs } = setup(parallel);
    checkTerminalFlows(layout, step, runs);
    const junctions = new Map();
    for (const { points, amperes, nodeId } of runs) {
      for (const [point, sign] of [[points[0], 1], [points.at(-1), -1]]) {
        const key = `${nodeId}:${point.x},${point.y}`;
        if (!junctions.has(key)) junctions.set(key, []);
        junctions.get(key).push(sign * amperes);
      }
    }
    const splits = [...junctions.values()].filter((currents) => currents.length === 3);
    expect(splits).toHaveLength(2);
    for (const currents of splits) {
      expect(currents.reduce((sum, amps) => sum + amps, 0)).toBeCloseTo(0, 10);
      expect(Math.max(...currents.map(Math.abs))).toBeCloseTo(18 / 7, 10);
    }
  });

  it.each([12, -12])('continues the signed flow through all three zigzags with a %s V supply', (volts) => {
    const values = { V1: `${volts} V`, R1: '2 ohm', R2: '6 ohm', R3: '3 ohm' };
    const capture = { ...parallel, components: parallel.components.map((c) => ({ ...c, visible_value: values[c.id] })) };
    const { layout, step, runs } = setup(capture);
    const stitched = stitchResistorParticleRuns(layout, step.branchFlows, runs);
    expect(stitched.flatMap(({ resistorIds = [] }) => resistorIds).sort()).toEqual(['R1', 'R2', 'R3']);
    expect(stitched).toHaveLength(runs.length - 3);
    for (const [id, amps] of [['R1', 3], ['R2', 1], ['R3', 2]]) {
      const part = layout.components.find((component) => component.id === id);
      const branch = step.branchFlows.find(({ componentId }) => componentId === id);
      const run = stitched.find(({ resistorIds }) => resistorIds?.includes(id));
      const { from, to, body } = resistorGeometry(part);
      const forward = (branch.current > 0 ? branch.fromTerminal : branch.toTerminal) === part.terminals[0].label;
      const trace = forward ? [from, ...body, to] : [to, ...body.reverse(), from];
      const index = run.points.findIndex((point) => samePoint(point, trace[0]));
      expect(index).toBeGreaterThan(0);
      expect(run.points.slice(index, index + trace.length).map(({ x, y }) => ({ x, y }))).toEqual(trace);
      expect(run.points.length).toBeGreaterThan(index + trace.length);
      expect(run.amperes).toBeCloseTo(amps, 12);
    }
  });

  it('keeps source behavior and leaves unmatched or zero-current resistors stationary', () => {
    const { layout, step, runs } = setup(series);
    const stitched = stitchResistorParticleRuns(layout, step.branchFlows, runs);
    expect(stitched).toHaveLength(1);
    const voltageSource = layout.components.find(({ type }) => type === 'battery' || type === 'voltage_source');
    const points = stitched[0].points;
    expect(voltageSource.terminals.every((t) => [points[0], points.at(-1)].some((p) => samePoint(t, p)))).toBe(true);
    expect(stitchResistorParticleRuns(layout, step.branchFlows, runs.slice(1))).toEqual(runs.slice(1));
    const zero = step.branchFlows.map((branch) => branch.type === 'resistor' ? { ...branch, current: 0 } : branch);
    expect(stitchResistorParticleRuns(layout, zero, runs)).toEqual(runs);
  });

  it('preserves opposing directions from multiple independent sources', () => {
    const { graph, layout, step, runs } = setup(mixedSources);
    expect(step.branchFlows.filter(({ sourceCurrent, sourceVoltage }) => sourceCurrent != null || sourceVoltage != null))
      .toHaveLength(2);
    checkTerminalFlows(layout, step, runs);
    expect(mapDcCurrentParticles(graph, layout, { ...step, branchFlows: step.branchFlows.slice(1) })).toEqual([]);
  });

  it('keeps other flows but adds no particle run at a zero-current source terminal', () => {
    const capture = { ...currentSource, components: currentSource.components.map((c) =>
      c.type === 'current_source' ? { ...c, visible_value: '0 A' } : c) };
    const { layout, step, runs } = setup(capture);
    expect(runs.length).toBeGreaterThan(0);
    checkTerminalFlows(layout, step, runs);
    const { terminals } = layout.components.find(({ type }) => type === 'current_source');
    expect(runs.some(({ points }) => terminals.some((t) => samePoint(points[0], t) || samePoint(points.at(-1), t))))
      .toBe(false);
  });

  it('suppresses disconnected point sets, mismatched endpoints and ambiguous conductor cycles', () => {
    const { graph, layout, step, runs } = setup(series);
    const allWires = layout.allWires ?? layout.wires;
    const original = allWires[0];
    const net = original.node;
    const a = original.points[0];
    const b = original.points.at(-1);
    const upper = Math.min(a.y, b.y) - 35;
    const alternate = { ...original, id: 'alternate', points: [
      a, { x: a.x, y: upper }, { x: b.x, y: upper }, b,
    ] };
    for (const edited of [
      allWires.filter((wire) => wire.node !== net),
      allWires.map((wire) => wire === original ? { ...wire, points: [{ x: a.x + 10, y: a.y }, b] } : wire),
      [...allWires, alternate],
    ]) {
      const remaining = mapDcCurrentParticles(graph, { ...layout, allWires: edited }, step);
      expect(remaining).toEqual(runs.filter(({ nodeId }) => nodeId !== net));
    }
  });

  it('deduplicates the same physical segment and suppresses disputed reconstruction', () => {
    const { graph, layout, step, runs } = setup(parallel);
    const wires = layout.allWires ?? layout.wires;
    expect(mapDcCurrentParticles(graph, { ...layout, allWires: [...wires, { ...wires[0], id: 'duplicate' }] }, step))
      .toEqual(runs);
    expect(mapDcCurrentParticles(graph, { ...layout, incomplete: true }, step)).toEqual([]);
    expect(mapDcCurrentParticles(graph, { ...layout, renderValidation: { isValid: false } }, step)).toEqual([]);
    expect(mapDcCurrentParticles(graph, layout, null)).toEqual([]);
  });

  it('animates solved currents across methods, never mesh reference arrows or partial reductions', () => {
    const { graph, layout } = setup(parallel);
    const lessons = [
      buildDcLesson(graph, solveDcCircuit(graph), { kind: 'general' }),
      buildDcMeshLesson(solveDcMeshCircuit(graph)),
      buildDcSeriesParallelLesson(solveDcSeriesParallel(graph)),
    ];
    for (const lesson of lessons) {
      expect(mapDcCurrentParticles(graph, layout, lesson.steps[0])).toEqual([]);
      const runs = mapDcCurrentParticles(graph, layout, lesson.steps.at(-1));
      expect(runs).toHaveLength(7);
      checkTerminalFlows(layout, lesson.steps.at(-1), runs);
    }
    const partial = setup(mixedSources);
    const lesson = buildDcSeriesParallelLesson(solveDcSeriesParallel(partial.graph));
    expect(lesson.steps.every((step) => !mapDcCurrentParticles(partial.graph, partial.layout, step).length)).toBe(true);
  });

  it('compresses speed differences and scales Slow, Normal and Fast monotonically', () => {
    const particleTime = (amps, speed) => dcParticleDuration(amps, 10, speed);
    expect(particleTime(2, 'slow')).toBeGreaterThan(particleTime(2, 'normal'));
    expect(particleTime(2, 'fast')).toBeLessThan(particleTime(2, 'normal'));
    expect(particleTime(10, 'normal')).toBeLessThan(particleTime(1e-8, 'normal'));
    expect(particleTime(1e-8, 'normal') / particleTime(10, 'normal')).toBeLessThan(2.3);
  });
});
