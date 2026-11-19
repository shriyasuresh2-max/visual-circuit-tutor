import { describe, expect, it } from 'vitest';
import { parseDcQuestion, answerDcQuestion } from './dcQuestions.js';

const result = {
  ok: true,
  referenceNodeId: 'N1',
  nodes: [{ id: 'N0', voltage: 12 }, { id: 'N1', voltage: 0 }],
  branches: [
    { componentId: 'R1', resistance: 4, voltage: -12, current: -3 },
    { componentId: 'V1', sourceVoltage: 12, voltage: 12, current: -3 },
  ],
};
const answer = (text, solved = result) => answerDcQuestion(parseDcQuestion(text), solved);

describe('DC question interpretation', () => {
  it.each([
    ['', 'general'],
    ['   ', 'general'],
    ['What is the current through resistor R1?', 'branch-current', 'R1'],
    ['How much current flows through R1?', 'branch-current', 'R1'],
    ['What is the voltage drop across R1?', 'resistor-voltage', 'R1'],
    ['Power dissipated by R1', 'resistor-power', 'R1'],
    ['Voltage at node N0', 'node-voltage', 'N0'],
    ['Current supplied by V1 using nodal analysis', 'source-supply', 'V1'],
    ['How much AC current flows through R1?', 'unsupported'],
    ['What current does V1 supply?', 'source-supply', 'V1'],
    ['List all node voltages', 'node-voltages'],
    ['Show all branch currents', 'branch-currents'],
    ['General nodal analysis', 'general'],
    ['Use MNA to find the current through R1', 'branch-current', 'R1'],
    ['Using KCL, find the voltage at N0', 'node-voltage', 'N0'],
  ])('interprets %j as %s', (text, kind, target) => {
    expect(parseDcQuestion(text)).toMatchObject({ kind, ...(target ? { target } : {}) });
  });

  it('reports unsupported methods and out-of-scope questions', () => {
    expect(parseDcQuestion('Find the current through R1 using mesh analysis')).toMatchObject({
      kind: 'unsupported', message: expect.stringContaining('method is unavailable'),
    });
    for (const text of ['What is the RC time constant?', 'Voltage across R1 after 2 seconds', 'Estimate the capacitance']) {
      expect(parseDcQuestion(text).kind).toBe('unsupported');
    }
  });

  it('asks for clarification rather than selecting one of several named targets', () => {
    expect(answer('Current through R1 or R2')).toMatchObject({
      kind: 'unsupported', message: expect.stringContaining('multiple targets'),
    });
  });
});

describe('DC question answers', () => {
  it('selects signed branch measurements and calculates positive resistor dissipation', () => {
    expect(answer('Current through r1')).toMatchObject({ kind: 'branch-current', value: -3 });
    expect(answer('Voltage across R1')).toMatchObject({ kind: 'resistor-voltage', value: -12 });
    expect(answer('Power dissipated by R1')).toMatchObject({ kind: 'resistor-power', value: 36 });
    expect(answer('Voltage at n0')).toMatchObject({ kind: 'node-voltage', node: { id: 'N0', voltage: 12 } });
  });

  it('reports the opposite of passive source current for supplied current', () => {
    expect(answer('Current supplied by V1')).toMatchObject({ kind: 'source-supply', value: 3 });
    const absorbing = { ...result, branches: [{ ...result.branches[1], current: 2 }] };
    expect(answer('Current supplied by the voltage source', absorbing)).toMatchObject({
      kind: 'source-supply', value: -2,
    });
  });

  it('blocks unknown IDs, ambiguous casing, type mismatches and unnamed multiple sources', () => {
    expect(answer('Current through R9').message).toContain('No component');
    expect(answer('Voltage at N9').message).toContain('No node');
    expect(answer('Power dissipated by V1').message).toContain('Name a resistor');
    expect(answer('Current supplied by R1').message).toContain('Name a voltage source');
    const ambiguous = {
      ...result,
      branches: [{ ...result.branches[0], componentId: 'LOAD' }, { ...result.branches[0], componentId: 'Load' },
        ...result.branches, { ...result.branches[1], componentId: 'V2' }],
    };
    expect(answer('Current through load', ambiguous).message).toContain('More than one component');
    expect(answer('Current through Load', ambiguous).branch.componentId).toBe('Load');
    expect(answer('Current supplied by the voltage source', ambiguous).message).toContain('More than one voltage source');
  });

  it('never returns a quantity for an unsolved circuit', () => {
    expect(answer('Current through R1', { ok: false })).toEqual({ kind: 'unavailable' });
  });
});
