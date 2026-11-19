import { describe, expect, it } from 'vitest';
import rawCapture from '../../tests/fixtures/split_singleton_connection_analysis.json';
import { buildGraph } from './electricalGraph.js';
import { layoutCircuit } from './circuitLayout.js';
import { solveDcCircuit } from './dcSolver.js';

const partition = (graph) => graph.nodes.map(({ members }) => [...members].sort()).sort();
const terminalNet = (graph, terminal) => graph.nodes.find(({ members }) => members.includes(terminal)).id;
const cloneCapture = () => structuredClone(rawCapture);

describe('contradictory singleton endpoint declarations', () => {
  it('replays the Gemini capture through graph construction, rendering and the solver', () => {
    expect(rawCapture.nodes.slice(0, 2).map(({ members }) => members)).toEqual([['V1.+'], ['R1.A']]);
    const graph = buildGraph(rawCapture);
    expect(partition(graph)).toEqual([
      ['R1.A', 'V1.+'], ['R1.B', 'R2.A', 'R3.A'], ['R2.B', 'R3.B', 'V1.−'],
    ]);
    expect(graph.incomplete).toBe(false);
    expect(graph.provisional).toEqual([]);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: 'singleton-declarations-resolved', from: 'V1.+', to: 'R1.A', wireId: 'W1',
    }));
    expect(graph.diagnostics.some(({ code }) =>
      ['wire-trace-node-disagreement', 'declared-node-conflict'].includes(code))).toBe(false);
    expect(graph.validation.warnings).not.toContainEqual(expect.stringMatching(/orphan|split across/));

    const layout = layoutCircuit(rawCapture, graph);
    expect(partition(layout)).toEqual(partition(graph));
    expect(layout.incomplete).toBe(false);
    expect(layout.renderValidation.errors).toEqual([]);
    expect(layout.allWires).toContainEqual(expect.objectContaining({
      id: 'W1', from: 'V1.+', to: 'R1.A', isExtracted: true, node: terminalNet(graph, 'R1.A'),
    }));
    for (const { from, to, node } of layout.allWires) {
      const { members } = graph.nodes.find(({ id }) => id === node);
      expect([from, to].every((endpoint) => endpoint === `NODE:${node}` || members.includes(endpoint))).toBe(true);
    }

    const solved = solveDcCircuit(graph);
    expect(solved.ok).toBe(true);
    const branches = new Map(solved.branches.map((branch) => [branch.componentId, branch]));
    expect(branches.get('R1').current).toBeCloseTo(18 / 7, 12);
    expect(branches.get('R2').current).toBeCloseTo(12 / 7, 12);
    expect(branches.get('R3').current).toBeCloseTo(6 / 7, 12);
    expect(branches.get('V1').voltage / -branches.get('V1').current).toBeCloseTo(7, 12);
  });

  it.each([
    ['missing trace', (a) => a.wires.shift()],
    ['trace that stops short', (a) => { a.wires[0].points.at(-1).x -= 0.01; }],
    ['weak trace', (a) => { a.wires[0].confidence = 0.6; }],
    ['crossing flag', (a) => { a.wires[0].is_crossing = true; }],
    ['crossing trace without a flag', (a) => {
      a.wires[1].points = [{ x: 0.145, y: 0.35 }, { x: 0.17, y: 0.35 }];
    }],
    ['competing terminal claim', (a) => {
      a.connections.push({ ...a.connections[0], to_component: 'R2', status: 'uncertain' });
    }],
    ['junction evidence at one endpoint', (a) => {
      a.junctions.push({ id: 'extra', members: ['V1.+', 'R2.A'] });
    }],
    ['an established multi-terminal group', (a) => {
      a.nodes[0].members.push(a.nodes[2].members.pop());
    }],
  ])('withholds the connection with %s', (_case, alter) => {
    const analysis = cloneCapture();
    alter(analysis);
    const result = buildGraph(analysis);
    expect(terminalNet(result, 'V1.+')).not.toBe(terminalNet(result, 'R1.A'));
    expect(result.incomplete).toBe(true);
    expect(result.diagnostics.some(({ code }) => code === 'singleton-declarations-resolved')).toBe(false);
    expect(solveDcCircuit(result).ok).toBe(false);
  });

  it('preserves an explicit incomplete flag even when it can repair the pair locally', () => {
    const result = buildGraph({ ...rawCapture, reconstruction_incomplete: true });
    expect(terminalNet(result, 'V1.+')).toBe(terminalNet(result, 'R1.A'));
    expect(result.incomplete).toBe(true);
    expect(solveDcCircuit(result).ok).toBe(false);
  });
});
