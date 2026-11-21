import { describe, expect, it } from 'vitest';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { buildDcLesson } from './dcLesson.js';
import { parseDcQuestion } from './dcQuestions.js';

const resistor = (id, visible_value) => component(id, 'resistor', visible_value, ['A', 'B']);
const source = (id, visible_value, labels = ['+', '−']) => component(id, 'voltage_source', visible_value, labels);
const currentSource = (id, visible_value, fromTerminal = 'A', toTerminal = 'B') => ({
  ...component(id, 'current_source', visible_value, ['A', 'B']),
  currentDirection: { fromTerminal, toTerminal },
});

function component(id, type, visible_value, labels) {
  return { id, type, visible_value, terminals: labels.map((label) => ({ label })) };
}

function graphFrom(components, memberships, extra = {}) {
  return buildGraph({
    components,
    nodes: memberships.map((members, i) => ({ id: `group-${i}`, members })),
    ...extra,
  });
}

function voltageAt(graph, result, terminal) {
  const { id } = graph.nodes.find((node) => node.members.includes(terminal));
  return result.nodes.find((node) => node.id === id).voltage;
}

function checkSolution(graph, result, nodeVoltages, branchValues, loops) {
  expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  for (const [terminal, voltage] of Object.entries(nodeVoltages)) {
    expect(voltageAt(graph, result, terminal)).toBeCloseTo(voltage, 10);
  }

  const branches = new Map(result.branches.map((branch) => [branch.componentId, branch]));
  expect(branches.size).toBe(Object.keys(branchValues).length);
  for (const [id, [voltage, current]] of Object.entries(branchValues)) {
    const branch = branches.get(id);
    expect(branch.voltage).toBeCloseTo(voltage, 10);
    expect(branch.current).toBeCloseTo(current, 10);
    if (branch.type === 'resistor') {
      expect(branch.voltage - branch.resistance * branch.current).toBeCloseTo(0, 10);
    }
  }

  for (const node of result.nodes) {
    // Reconstruct KCL from the signed branch results independently of the
    // returned terms and residuals.
    let sum = 0;
    for (const branch of branches.values()) {
      if (branch.fromNodeId === node.id) sum += branch.current;
      if (branch.toNodeId === node.id) sum -= branch.current;
    }
    expect(sum).toBeCloseTo(0, 10);
    expect(node.kclResidual).toBeCloseTo(sum, 10);
    expect(node.currents).toHaveLength(graph.nodes.find((n) => n.id === node.id).members.length);
  }
  // Verify KVL using constitutive drops rather than telescoping node voltages.
  for (const loop of loops) {
    let sum = 0;
    for (const [id, direction] of loop) {
      const branch = branches.get(id);
      sum += direction * (branch.sourceCurrent != null ? branch.voltage
        : branch.sourceVoltage ?? branch.resistance * branch.current);
    }
    expect(sum).toBeCloseTo(0, 10);
  }
  expect(result.residuals.maxKclResidual).toBeLessThan(1e-10);
  expect(result.residuals.maxSourceVoltageResidual).toBeLessThan(1e-10);
}

function seriesGraph(voltage = '12 V', resistance = '2 Ω') {
  return graphFrom(
    [source('S', voltage), resistor('R1', resistance), resistor('R2', '4 ohms')],
    [['S.+', 'R1.A'], ['R1.B', 'R2.A'], ['R2.B', 'S.−']],
  );
}

describe('solveDcCircuit uses reconstructed electrical nodes', () => {
  it('solves a series loop without reading geometry or mutating its input', () => {
    const graph = seriesGraph();
    for (const part of graph.components) part.center = { x: 0, y: 0 };
    const before = structuredClone(graph);
    const result = solveDcCircuit(graph);
    checkSolution(graph, result, { 'S.+': 12, 'R1.B': 8, 'S.−': 0 },
      { S: [12, -2], R1: [4, 2], R2: [8, 2] }, [[['S', -1], ['R1', 1], ['R2', 1]]]);
    expect(graph).toEqual(before);
    expect(solveDcCircuit(graph)).toEqual(result);
  });

  it('solves two parallel branches with SI prefixes and a different reference', () => {
    const graph = graphFrom(
      [source('S', '6e3 mV'), resistor('P', '1,5 kΩ'), resistor('Q', '3 kΩ')],
      [['S.+', 'P.A', 'Q.A'], ['S.−', 'P.B', 'Q.B']],
    );
    const referenceNodeId = graph.nodes.find((node) => node.members.includes('S.+')).id;
    const result = solveDcCircuit(graph, { referenceNodeId });
    expect(result.referenceNodeId).toBe(referenceNodeId);
    checkSolution(graph, result, { 'S.+': 0, 'S.−': -6 },
      { S: [6, -0.006], P: [6, 0.004], Q: [6, 0.002] }, [[['P', 1], ['Q', -1]]]);
  });

  it('solves an unbalanced bridge with nonzero cross-branch current', () => {
    const graph = graphFrom(
      [source('S', '10 V'), ...['1 Ω', '2 Ω', '2 Ω', '1 Ω', '2 Ω'].map((v, i) => resistor(`R${i + 1}`, v))],
      [
        ['S.+', 'R1.A', 'R2.A'], ['R1.B', 'R3.A', 'R5.A'],
        ['R2.B', 'R4.A', 'R5.B'], ['S.−', 'R3.B', 'R4.B'],
      ],
    );
    checkSolution(graph, solveDcCircuit(graph), { 'S.+': 10, 'R1.B': 6, 'R2.B': 4, 'S.−': 0 },
      { S: [10, -7], R1: [4, 4], R2: [6, 3], R3: [6, 3], R4: [4, 4], R5: [2, 1] },
      [[['R1', 1], ['R5', 1], ['R2', -1]], [['R3', 1], ['R4', -1], ['R5', -1]],
        [['S', -1], ['R1', 1], ['R3', 1]]]);
  });

  it('solves a multi-loop network with a shared return resistor', () => {
    const graph = graphFrom(
      [source('S', '18 V'), resistor('P', '3 Ω'), resistor('Q', '6 Ω'), resistor('T', '4 Ω')],
      [['S.+', 'P.A', 'Q.A'], ['P.B', 'Q.B', 'T.A'], ['S.−', 'T.B']],
    );
    checkSolution(graph, solveDcCircuit(graph), { 'S.+': 18, 'P.B': 12, 'S.−': 0 },
      { S: [18, -3], P: [6, 2], Q: [6, 1], T: [12, 3] },
      [[['P', 1], ['T', 1], ['S', -1]], [['Q', 1], ['T', 1], ['S', -1]]]);
  });

  it('solves independent sources with an ungrounded source and reversed terminal order', () => {
    const graph = graphFrom(
      [source('S1', '8 V'), source('S2', '4 V', ['−', '+']), resistor('P', '6 Ω'), resistor('Q', '4 Ω')],
      [['S1.−', 'P.B', 'Q.B'], ['S1.+', 'S2.−', 'Q.A'], ['S2.+', 'P.A']],
    );
    checkSolution(graph, solveDcCircuit(graph), { 'S1.−': 0, 'S1.+': 8, 'S2.+': 12 },
      { S1: [8, -4], S2: [4, -2], P: [12, 2], Q: [8, 2] },
      [[['S1', 1], ['Q', -1]], [['S1', 1], ['S2', 1], ['P', -1]]]);
  });

  it('returns zero for a complete source-free resistor network', () => {
    const graph = graphFrom(
      [resistor('R1', '2 Ω'), resistor('R2', '4 Ω')],
      [['R1.A', 'R2.A'], ['R1.B', 'R2.B']],
    );
    checkSolution(graph, solveDcCircuit(graph), { 'R1.A': 0, 'R1.B': 0 },
      { R1: [0, 0], R2: [0, 0] }, [[['R1', 1], ['R2', -1]]]);
  });

  it('solves a passive loop attached to the powered network at a single node', () => {
    const graph = graphFrom(
      [source('S', '12 V'), resistor('R', '4 Ω'), resistor('P', '3 Ω'),
        resistor('Q', '7 Ω'), resistor('T', '11 Ω')],
      [['S.+', 'R.A', 'P.A', 'T.B'], ['S.−', 'R.B'], ['P.B', 'Q.A'], ['Q.B', 'T.A']],
    );
    checkSolution(graph, solveDcCircuit(graph), { 'S.+': 12, 'P.B': 12, 'Q.B': 12, 'S.−': 0 },
      { S: [12, -3], R: [12, 3], P: [0, 0], Q: [0, 0], T: [0, 0] },
      [[['S', 1], ['R', -1]], [['P', 1], ['Q', 1], ['T', 1]]]);
  });
});

describe('solveDcCircuit stamps independent ideal current sources into KCL', () => {
  function currentLoop(value, fromTerminal = 'A', toTerminal = 'B') {
    return graphFrom([currentSource('I', value, fromTerminal, toTerminal), resistor('R', '2 kΩ')],
      [['I.A', 'R.B'], ['I.B', 'R.A']]);
  }

  it.each([['2 mA', 0.002], ['−0.002 amperes', -0.002], ['0 A', 0]])(
    'solves one current source feeding a resistor at %s',
    (value, amps) => {
      const graph = currentLoop(value);
      const result = solveDcCircuit(graph);
      checkSolution(graph, result, { 'I.A': 0, 'I.B': 2000 * amps },
        { I: [-2000 * amps, amps], R: [2000 * amps, amps] }, [[['I', 1], ['R', 1]]]);
      const branch = result.branches.find(({ componentId }) => componentId === 'I');
      expect(branch).toMatchObject({
        sourceCurrent: amps, fromTerminal: 'A', toTerminal: 'B',
        fromNodeId: result.referenceNodeId,
      });
      expect(branch).not.toHaveProperty('sourceVoltage');
      expect(branch).not.toHaveProperty('resistance');
    },
  );

  it('uses the declared direction even when it reverses terminal order', () => {
    const graph = currentLoop('2 mA', ' B ', 'A');
    const result = solveDcCircuit(graph);
    expect(graph.components[0].currentDirection).toEqual({ fromTerminal: 'B', toTerminal: 'A' });
    checkSolution(graph, result, { 'I.A': 0, 'I.B': -4 },
      { I: [-4, 0.002], R: [-4, -0.002] }, [[['I', 1], ['R', -1]]]);
    expect(result.branches[0]).toMatchObject({ fromTerminal: 'B', toTerminal: 'A' });
  });

  it('superposes multiple parallel current sources with opposite directions', () => {
    const graph = graphFrom([
      currentSource('I1', '3 A'), currentSource('I2', '1 A', 'B', 'A'),
      currentSource('I3', '500 mA'), resistor('R', '4 Ω'),
    ], [['I1.A', 'I2.A', 'I3.A', 'R.B'], ['I1.B', 'I2.B', 'I3.B', 'R.A']]);
    checkSolution(graph, solveDcCircuit(graph), { 'I1.A': 0, 'I1.B': 10 },
      { I1: [-10, 3], I2: [10, 1], I3: [-10, 0.5], R: [10, 2.5] },
      [[['I1', 1], ['R', 1]], [['I2', 1], ['I3', 1]]]);
  });

  it('uses the voltage-source reference and solves a source between two non-reference nodes', () => {
    const graph = graphFrom([
      currentSource('I', '1 A'), source('V', '8 V'), resistor('R1', '2 Ω'), resistor('R2', '4 Ω'),
    ], [['I.A', 'V.+', 'R1.A'], ['I.B', 'R1.B', 'R2.A'], ['V.−', 'R2.B']]);
    const result = solveDcCircuit(graph);
    checkSolution(graph, result, { 'V.+': 8, 'I.B': 20 / 3, 'V.−': 0 },
      { I: [4 / 3, 1], V: [8, -5 / 3], R1: [4 / 3, 2 / 3], R2: [20 / 3, 5 / 3] },
      [[['I', 1], ['R2', 1], ['V', -1]], [['I', 1], ['R1', -1]]]);
    const lesson = buildDcLesson(graph, result, parseDcQuestion(''));
    const substituted = lesson.steps.filter(({ id }) => ['constraints', 'kcl'].includes(id)).flatMap(({ workedEquations }) => workedEquations);
    expect(substituted.filter(({ kind }) => kind === 'source-constraint')).toHaveLength(1);
    const signedTerms = substituted.flatMap(({ terms }) => terms ?? []).filter(({ branchId }) => branchId === 'I');
    expect(signedTerms.map(({ sign, sourceCurrent }) => [sign, sourceCurrent])).toEqual([[-1, 1]]);
  });

  it('reports zero drop when both current-source terminals share one node', () => {
    const graph = graphFrom([currentSource('I', '2 A')], [['I.A', 'I.B']]);
    checkSolution(graph, solveDcCircuit(graph), { 'I.A': 0 }, { I: [0, 2] }, []);
  });

  it.each([
    ['2 A', 'singular-system'],
    ['1 A', 'inconsistent-system'],
  ])('classifies a current-only cut with opposing currents of 2 A and %s', (other, code) => {
    const graph = graphFrom([currentSource('I1', '2 A'), currentSource('I2', other, 'B', 'A')],
      [['I1.A', 'I2.A'], ['I1.B', 'I2.B']]);
    expect(solveDcCircuit(graph)).toMatchObject({
      ok: false, issues: [{ code, sourceIds: ['I1', 'I2'], nodeIds: [graph.nodes[1].id] }],
    });
  });

  it.each(['2 V', '2', '2 \u0300', '1e999 A'])('rejects invalid source current %s', (value) => {
    expect(solveDcCircuit(currentLoop(value))).toMatchObject({
      ok: false, issues: [{ code: 'invalid-current', componentId: 'I' }],
    });
  });

  it('requires a direction between distinct declared terminals', () => {
    for (const direction of [undefined, { fromTerminal: 'A', toTerminal: 'A' }, { fromTerminal: 'A', toTerminal: 'Q' }]) {
      const graph = currentLoop('1 A');
      graph.components[0].currentDirection = direction;
      expect(solveDcCircuit(graph)).toMatchObject({
        ok: false, issues: [{ code: 'unknown-current-direction', componentId: 'I' }],
      });
    }
  });
});

describe('solveDcCircuit rejects unsolvable or unverified circuits', () => {
  function expectIssue(result, code, context = {}) {
    expect(result).toMatchObject({ ok: false });
    expect(result.issues).toContainEqual(expect.objectContaining({ code, ...context }));
    expect(result).not.toHaveProperty('nodes');
    expect(result).not.toHaveProperty('branches');
  }

  it.each([
    [null, 'missing-value'], ['0 Ω', 'invalid-resistance'], ['-2 Ω', 'invalid-resistance'],
    ['2', 'invalid-resistance'], ['2 V', 'invalid-resistance'], ['1e999 Ω', 'invalid-resistance'],
  ])('rejects the extracted resistance %s', (raw, code) => {
    expectIssue(solveDcCircuit(seriesGraph('12 V', raw)), code, { componentId: 'R1' });
  });

  it('rejects a missing or unreadable source value', () => {
    expectIssue(solveDcCircuit(seriesGraph(null)), 'missing-value', { componentId: 'S' });
    expectIssue(solveDcCircuit(seriesGraph('12 ?')), 'invalid-voltage', { componentId: 'S' });
  });

  it('rejects an unsupported capacitor and an unknown source polarity', () => {
    const graph = seriesGraph();
    graph.components.find((part) => part.id === 'R1').type = 'capacitor';
    expectIssue(solveDcCircuit(graph), 'unsupported-component', { componentId: 'R1' });
    const unknown = graphFrom([source('S', '5 V', ['A', 'B']), resistor('R', '1 Ω')],
      [['S.A', 'R.A'], ['S.B', 'R.B']]);
    expectIssue(solveDcCircuit(unknown), 'unknown-polarity', { componentId: 'S' });
  });

  it('rejects disconnected subnetworks and identifies their floating nodes', () => {
    const graph = graphFrom(
      [source('S', '6 V'), resistor('R1', '2 Ω'), resistor('R2', '3 Ω'), resistor('R3', '4 Ω')],
      [['S.+', 'R1.A'], ['S.−', 'R1.B'], ['R2.A', 'R3.A'], ['R2.B', 'R3.B']],
    );
    const island = graph.nodes.filter((node) => node.members.some((key) => key.startsWith('R2.')));
    expectIssue(solveDcCircuit(graph), 'disconnected-network', { nodeIds: island.map((node) => node.id) });
  });

  it('rejects an isolated node and a terminal assignment that disagrees with the net', () => {
    const graph = seriesGraph();
    graph.nodes.push({ id: 'isolated', members: [] });
    expectIssue(solveDcCircuit(graph), 'floating-node', { nodeId: 'isolated' });
    graph.components[1].terminals[0].node = 'isolated';
    expectIssue(solveDcCircuit(graph), 'invalid-membership', { terminal: 'R1.A' });
  });

  it('reports the open terminal on an incomplete reconstruction', () => {
    const graph = graphFrom([source('S', '5 V'), resistor('R', '2 Ω')], [['S.+', 'R.A']]);
    const result = solveDcCircuit(graph);
    expectIssue(result, 'incomplete-connectivity');
    expectIssue(result, 'open-terminal', { nodeId: graph.nodes.find((node) => node.members.includes('R.B')).id });
  });

  it('rejects disputed connectivity even when every node has multiple terminals', () => {
    const graph = graphFrom([source('S', '5 V'), resistor('R', '1 Ω')], [['S.+', 'R.A'], ['S.−', 'R.B']], {
      connections: [{ from_component: 'S', from_terminal: '+', to_component: 'R', to_terminal: 'B', status: 'confirmed' }],
    });
    expect(graph.nodes.every((node) => node.members.length === 2)).toBe(true);
    expectIssue(solveDcCircuit(graph), 'incomplete-connectivity', {
      diagnostics: expect.arrayContaining([expect.stringMatching(/distinct declared nodes/)]),
    });
  });

  it.each([['5 V', 'singular-system'], ['6 V', 'inconsistent-system']])(
    'classifies an ideal source of %s in parallel with a 5 V source',
    (value, code) => {
      const graph = graphFrom([source('S1', '5 V'), source('S2', value), resistor('R', '2 Ω')],
        [['S1.+', 'S2.+', 'R.A'], ['S1.−', 'S2.−', 'R.B']]);
      expectIssue(solveDcCircuit(graph), code, { sourceIds: ['S1', 'S2'] });
    },
  );

  it('rejects a nonzero source drop lost at floating-point resolution', () => {
    const graph = graphFrom(
      [source('S1', '1e18 V'), source('S2', '1 V'), resistor('R', '1e18 Ω')],
      [['S1.−', 'R.B'], ['S1.+', 'S2.−'], ['S2.+', 'R.A']],
    );
    expectIssue(solveDcCircuit(graph), 'numerical-failure', { componentId: 'S2' });
  });
});
