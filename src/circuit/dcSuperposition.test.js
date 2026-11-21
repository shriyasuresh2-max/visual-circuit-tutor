import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { solveDcSuperposition } from './dcSuperposition.js';

const terminals = (...labels) => labels.map((label) => ({ label }));
const resistor = (id, visible_value) => ({ id, type: 'resistor', visible_value, terminals: terminals('A', 'B') });
const voltage = (id, visible_value, labels = ['+', '−']) => ({ id, type: 'voltage_source', visible_value, terminals: terminals(...labels) });
const current = (id, visible_value, reverse = false) => ({
  id, type: 'current_source', visible_value, terminals: terminals('A', 'B'),
  currentDirection: reverse ? { fromTerminal: 'B', toTerminal: 'A' } : { fromTerminal: 'A', toTerminal: 'B' },
});
const graphFrom = (components, memberships) => buildGraph({
  components, nodes: memberships.map((members, i) => ({ id: `group-${i}`, members })),
});
const branch = (result, id) => result.branches.find(({ componentId }) => componentId === id);
const byTerminal = (graph, terminal) => graph.nodes.find(({ members }) => members.includes(terminal)).id;
const response = (analysis, id) => analysis.contributions.find(({ activeSourceId }) => activeSourceId === id);

function opposingVoltages() {
  return graphFrom([voltage('V2', '4 V', ['−', '+']), resistor('R', '4 Ω'), voltage('V1', '12 V')], [
    ['V1.+', 'R.A'], ['V2.+', 'R.B'], ['V1.−', 'V2.−'],
  ]);
}

function verifyBalances(solution, loops) {
  for (const { id } of solution.nodes) {
    const sum = solution.branches.reduce((value, entry) => value +
      (entry.fromNodeId === id ? entry.current : 0) - (entry.toNodeId === id ? entry.current : 0), 0);
    expect(sum).toBeCloseTo(0, 10);
  }
  for (const loop of loops) {
    const sum = loop.reduce((value, [id, sign]) => {
      const entry = branch(solution, id);
      const drop = entry.resistance != null ? entry.resistance * entry.current : entry.sourceVoltage ?? entry.voltage;
      return value + sign * drop;
    }, 0);
    expect(sum).toBeCloseTo(0, 10);
  }
}

describe('solveDcSuperposition', () => {
  it('deactivates voltage sources to shorts and computes physical power after combining opposing contributions', () => {
    const graph = opposingVoltages();
    const before = structuredClone(graph);
    const result = solveDcSuperposition(graph);
    expect(result).toMatchObject({ ok: true, status: 'complete', verification: { status: 'verified' } });
    expect(graph).toEqual(before);
    expect(result.sources.map(({ componentId, kind, value, fromTerminal, toTerminal }) =>
      [componentId, kind, value, fromTerminal, toTerminal])).toEqual([
      ['V1', 'voltage', 12, '+', '−'], ['V2', 'voltage', 4, '+', '−'],
    ]);
    expect(result.referenceNodeId).toBe(byTerminal(graph, 'V1.−'));
    const v1 = response(result, 'V1');
    const v2 = response(result, 'V2');
    expect(v1.deactivatedSources).toEqual([{ componentId: 'V2', replacement: 'short', value: 0, unit: 'V' }]);
    expect(branch(v1, 'V2')).toMatchObject({ voltage: 0, current: 3, sourceVoltage: 0 });
    expect(branch(v2, 'V1')).toMatchObject({ voltage: 0, current: 1, sourceVoltage: 0 });
    expect(branch(v1, 'R')).toMatchObject({ voltage: 12, current: 3 });
    expect(branch(v2, 'R')).toMatchObject({ voltage: -4, current: -1 });
    expect(branch(result.combined, 'R')).toMatchObject({ voltage: 8, current: 2, power: 16 });
    expect(branch(result.combined, 'V1')).not.toHaveProperty('power');
    for (const solution of result.contributions) expect(solution.branches.every((entry) => !Object.hasOwn(entry, 'power'))).toBe(true);
    for (const solution of [v1, v2, result.combined]) verifyBalances(solution, [[['V1', 1], ['R', -1], ['V2', -1]]]);
  });

  it('combines parallel current sources, negative values, reversed arrows, and a zero-valued source', () => {
    const graph = graphFrom([current('I3', '0 A'), current('I1', '2 A'), current('I2', '-500 mA', true), resistor('R', '4 ohm')], [
      ['I1.A', 'I2.B', 'I3.A', 'R.B'], ['I1.B', 'I2.A', 'I3.B', 'R.A'],
    ]);
    // I2’s arrow is ground → load, but its signed value drives the opposite way.
    const result = solveDcSuperposition(graph, { referenceNodeId: byTerminal(graph, 'R.B') });
    expect(result.ok).toBe(true);
    expect(result.sources.map(({ componentId, value, fromTerminal, toTerminal }) => [componentId, value, fromTerminal, toTerminal]))
      .toEqual([['I1', 2, 'A', 'B'], ['I2', -0.5, 'B', 'A'], ['I3', 0, 'A', 'B']]);
    const alternate = response(result, 'I2');
    expect(branch(alternate, 'I1')).toMatchObject({ voltage: 2, current: 0, sourceCurrent: 0 });
    expect(alternate.deactivatedSources).toEqual([
      { componentId: 'I1', replacement: 'open', value: 0, unit: 'A' },
      { componentId: 'I3', replacement: 'open', value: 0, unit: 'A' },
    ]);
    expect(branch(alternate, 'R')).toMatchObject({ voltage: -2, current: -0.5 });
    expect(response(result, 'I3').branches.every(({ voltage: volts, current: amps }) => volts === 0 && amps === 0)).toBe(true);
    expect(branch(result.combined, 'R')).toMatchObject({ voltage: 6, current: 1.5, power: 9 });
  });

  it('decomposes a mixed-source bridge and verifies an independent loop and nodal balance', () => {
    const graph = graphFrom([voltage('V', '10 V'), current('I', '1 A'),
      ...[1, 2, 2, 1, 2].map((value, i) => resistor(`R${i + 1}`, `${value} Ω`)),
    ], [
      ['V.+', 'R1.A', 'R2.A'], ['I.A', 'R1.B', 'R3.A', 'R5.A'],
      ['I.B', 'R2.B', 'R4.A', 'R5.B'], ['V.−', 'R3.B', 'R4.B'],
    ]);
    const result = solveDcSuperposition(graph);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    const left = byTerminal(graph, 'I.A');
    const right = byTerminal(graph, 'I.B');
    const cases = [[response(result, 'V'), 6, 4, 1], [response(result, 'I'), -0.4, 0.4, -0.4], [result.combined, 5.6, 4.4, 0.6]];
    for (const [solution, l, r, amps] of cases) {
      expect(solution.nodes.find(({ id }) => id === left).voltage).toBeCloseTo(l, 11);
      expect(solution.nodes.find(({ id }) => id === right).voltage).toBeCloseTo(r, 11);
      expect(branch(solution, 'R5').current).toBeCloseTo(amps, 11);
      verifyBalances(solution, [[['V', 1], ['R1', -1], ['R3', -1]], [['R1', 1], ['R5', 1], ['R2', -1]], [['R5', 1], ['I', -1]]]);
    }
    const direct = solveDcCircuit(graph, { referenceNodeId: result.referenceNodeId });
    for (const { componentId, current: actual, voltage: drop } of result.combined.branches) {
      expect(actual).toBeCloseTo(branch(direct, componentId).current, 11);
      expect(drop).toBeCloseTo(branch(direct, componentId).voltage, 11);
    }
    expect(result.verification.maxKclResidual).toBeLessThan(1e-12);
    expect(result.verification.maxKvlResidual).toBeLessThan(1e-12);

    const zeroVoltage = { ...graph, components: graph.components.map((part) => part.id === 'V' ? { ...part, valueRaw: '0 V' } : part) };
    const zeroResult = solveDcSuperposition(zeroVoltage);
    expect(zeroResult.ok, JSON.stringify(zeroResult.issues)).toBe(true);
    expect(branch(zeroResult.combined, 'R5').current).toBeCloseTo(-0.4, 11);
  });

  it('reports both source-only branch responses, including voltage across an open and current through a short', () => {
    const graph = graphFrom([voltage('V', '-6 V'), current('I', '2 A')], [['V.+', 'I.B'], ['V.−', 'I.A']]);
    const result = solveDcSuperposition(graph);
    expect(result.ok).toBe(true);
    expect(branch(response(result, 'V'), 'I')).toMatchObject({ voltage: 6, current: 0 });
    expect(branch(response(result, 'I'), 'V')).toMatchObject({ voltage: 0, current: 2 });
    expect(branch(result.combined, 'V')).toMatchObject({ voltage: -6, current: 2 });
    expect(branch(result.combined, 'I')).toMatchObject({ voltage: 6, current: 2 });
    const short = graphFrom([voltage('V', '0 V'), current('I', '2 A')], [['V.+', 'I.B'], ['V.−', 'I.A']]);
    const zeroSource = solveDcSuperposition(short);
    expect(branch(response(zeroSource, 'V'), 'V').current).toBe(0);
    expect(branch(zeroSource.combined, 'V').current).toBe(2);
  });

  it('keeps identical output under input order changes and shares an explicitly selected reference', () => {
    const graph = opposingVoltages();
    const renamed = { ...graph, nodes: [...graph.nodes].reverse(), components: [...graph.components].reverse() };
    const ordinary = solveDcSuperposition(graph);
    expect(solveDcSuperposition(renamed)).toEqual(ordinary);
    const referenceNodeId = byTerminal(graph, 'R.A');
    const shifted = solveDcSuperposition(renamed, { referenceNodeId });
    expect(shifted.referenceNodeId).toBe(referenceNodeId);
    for (const result of [shifted.directResult, ...shifted.contributions]) {
      expect(result.referenceNodeId).toBe(referenceNodeId);
      expect(result.nodes.find(({ id }) => id === referenceNodeId).voltage).toBe(0);
    }
    expect(shifted.combined.branches).toEqual(ordinary.combined.branches);
    expect(solveDcSuperposition(graph, { referenceNodeId: 'missing' }).issues[0].code).toBe('invalid-reference');
  });

  it('handles an empty source sum on a verified passive network', () => {
    const graph = graphFrom([resistor('R1', '3 Ω'), resistor('R2', '5 Ω')], [['R1.A', 'R2.A'], ['R1.B', 'R2.B']]);
    const result = solveDcSuperposition(graph);
    expect(result).toMatchObject({ ok: true, sources: [], contributions: [], verification: { status: 'verified' } });
    expect(result.combined.branches.every(({ voltage: volts, current: amps, power }) => volts === 0 && amps === 0 && power === 0)).toBe(true);
  });

  it.each([['3 V', 'inconsistent-system'], ['5 V', 'singular-system']])('reports %s parallel voltage-source constraints without publishing a combined solution', (value, code) => {
    const graph = graphFrom([voltage('V1', '5 V'), voltage('V2', value)], [['V1.+', 'V2.+'], ['V1.−', 'V2.−']]);
    const result = solveDcSuperposition(graph);
    expect(result.directResult.issues[0].code).toBe(code);
    expect(result.contributions.map((contribution) => contribution.issues[0].code)).toEqual(['inconsistent-system', 'inconsistent-system']);
    expect(result.verification.status).toBe('not-run');
    expect(result).not.toHaveProperty('combined');
  });

  it('reports a floating source-only network and the inconsistent cases when opening either parallel source', () => {
    const graph = graphFrom([current('I1', '2 A'), current('I2', '2 A', true)], [['I1.A', 'I2.A'], ['I1.B', 'I2.B']]);
    const result = solveDcSuperposition(graph);
    expect(result.directResult.issues[0]).toMatchObject({ code: 'singular-system', nodeIds: expect.any(Array) });
    expect(result.contributions.map(({ deactivatedSources, issues }) => [deactivatedSources[0].replacement, issues[0].code]))
      .toEqual([['open', 'inconsistent-system'], ['open', 'inconsistent-system']]);
    expect(result.issues.map(({ code }) => code)).toEqual(['original-solve-failed', 'contribution-solve-failed', 'contribution-solve-failed']);
    expect(result).not.toHaveProperty('combined');
  });

  it('keeps disconnected islands and rejects invalid, incomplete, or unsupported inputs', () => {
    const graph = graphFrom([voltage('V1', '5 V'), resistor('R1', '2 Ω'), voltage('V2', '0 V'), resistor('R2', '3 Ω')], [
      ['V1.+', 'R1.A'], ['V1.−', 'R1.B'], ['V2.+', 'R2.A'], ['V2.−', 'R2.B'],
    ]);
    const disconnected = solveDcSuperposition(graph);
    expect(disconnected.directResult.issues[0].code).toBe('disconnected-network');
    expect(disconnected.contributions.every(({ ok, issues }) => !ok && issues[0].code === 'disconnected-network')).toBe(true);
    const invalid = opposingVoltages();
    invalid.components.find(({ id }) => id === 'R').valueRaw = '0 Ω';
    expect(solveDcSuperposition(invalid).issues[0].code).toBe('invalid-resistance');
    expect(solveDcSuperposition({ ...opposingVoltages(), incomplete: true }).issues[0].code).toBe('incomplete-connectivity');
    const unsupported = opposingVoltages();
    unsupported.components.find(({ id }) => id === 'R').type = 'capacitor';
    expect(solveDcSuperposition(unsupported)).toMatchObject({ ok: false, status: 'unsupported', issues: [{ code: 'unsupported-component' }] });
  });

  it('returns a structured numerical failure when combined resistor power cannot be represented', () => {
    const graph = graphFrom([voltage('V', '1e160 V'), resistor('R', '1 Ω')], [['V.+', 'R.A'], ['V.−', 'R.B']]);
    const result = solveDcSuperposition(graph);
    expect(result.directResult.ok).toBe(true);
    expect(result).toMatchObject({ ok: false, verification: { status: 'failed' }, issues: [{ code: 'power-out-of-range', componentId: 'R' }] });
    expect(result).not.toHaveProperty('combined');
  });
});
