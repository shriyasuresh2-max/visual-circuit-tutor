import { buildDcLesson } from './dcLesson.js';
import { answerDcQuestion } from './dcQuestions.js';
import { termKey } from './electricalGraph.js';

const branchEntry = (branch) => ({ kind: 'transform-original-branch', ...branch,
  expression: `${branch.componentId} (${branch.fromTerminal} to ${branch.toTerminal}): ${branch.voltage} V, ${branch.current} A.`,
});

function originalResistorStep(result, answer, flow) {
  const branch = answer.branch;
  const pair = result.steps.find(({ original }) => original.resistor.id === branch?.componentId);
  if (result.verification.status !== 'verified' || !pair) return null;

  const { a, b, original: { resistor }, terminalBehavior } = pair;
  const series = pair.direction === 'voltage-to-current';
  const solvedNodes = new Map(result.verification.transformed.nodes.map(({ id, voltage }) => [id, voltage]));
  const va = solvedNodes.get(a);
  const vb = solvedNodes.get(b);
  const portVoltage = va - vb;
  const openVoltage = terminalBehavior.original.openVoltage;
  const sign = (series ? resistor.from.node === b || resistor.to.node === a : resistor.from.node === a) ? 1 : -1;
  const amps = sign * (series ? openVoltage - portVoltage : portVoltage) / resistor.value;
  const volts = amps * resistor.value;
  const voltageScale = Math.max(Math.abs(va), Math.abs(vb), Math.abs(openVoltage), Math.abs(branch.voltage));
  if (![amps, volts, voltageScale].every(Number.isFinite) ||
      Math.abs(volts - branch.voltage) > 1e-9 * voltageScale ||
      Math.abs(amps - branch.current) > 1e-9 * Math.max(voltageScale / resistor.value, Math.abs(branch.current))) return null;

  const equation = { kind: 'transform-recover-resistor', id: branch.componentId, a, b, va, vb, portVoltage,
    series, sign, openVoltage, sourceId: pair.original.source.id, resistance: resistor.value,
    voltage: branch.voltage, current: branch.current,
    expression: `${branch.componentId}: ${branch.voltage} V and ${branch.current} A from ${branch.fromTerminal} to ${branch.toTerminal}.` };
  const power = answer.kind === 'resistor-power' ? { kind: 'resistor-power', id: branch.componentId, unit: 'W',
    branchVoltage: branch.voltage, branchCurrent: branch.current, value: answer.value,
    expression: `${branch.componentId} dissipates ${answer.value} W.` } : null;
  const drop = { ...equation, part: 'drop' };
  const current = { ...equation, part: 'current' };
  const equations = [{ ...equation, part: 'port' }, drop, current, ...(power ? [power] : [])];
  return {
    ...flow, id: 'transformation-recover-resistor', title: `Recover ${branch.componentId} in the original circuit`,
    explanation: series
      ? 'Use the solved equivalent network’s terminal voltage. The original series current comes from the source voltage minus that terminal voltage.'
      : 'Use the solved equivalent network’s terminal voltage across the original parallel resistor. Divide by its resistance in the original branch direction.',
    componentIds: [branch.componentId], nodeIds: [branch.fromNodeId, branch.toNodeId],
    equations, workedEquations: equations, finalAnswer: [drop, current, ...(power ? [power] : [])],
    primaryResult: power ?? (answer.kind === 'resistor-voltage' ? drop : current),
  };
}

function relevantReductions(result) {
  const replaced = new Set(result.steps.map(({ equivalent }) => equivalent.resistor.id));
  const needed = new Set();
  for (const group of result.reductions.toReversed()) {
    if (!needed.has(group.id) && !group.originalComponentIds.some((id) => replaced.has(id))) continue;
    needed.add(group.id);
    for (const { id } of group.members) needed.add(id);
  }
  return result.reductions.filter(({ id }) => needed.has(id));
}

export function buildDcSourceTransformationLesson(graph, result, intent = { kind: 'general' }) {
  if (!result?.ok || intent.kind === 'unsupported') return null;
  const steps = [];
  const originalIds = new Set(graph.components.map(({ id }) => id));
  for (const transformation of result.steps) {
    const { id, direction, a, b, original, equivalent, originalComponentIds, terminalBehavior } = transformation;
    const series = direction === 'voltage-to-current';
    const unit = series ? 'A' : 'V';
    const equation = {
      kind: 'transform-source', direction, sourceId: original.source.id, resistorId: original.resistor.id,
      input: original.source.value, resistance: original.resistor.value, value: equivalent.source.value,
      expression: `The equivalent source value is ${equivalent.source.value} ${unit}.`,
    };
    const port = { kind: 'transform-port', a, b, resistance: terminalBehavior.resistance, ...terminalBehavior.original,
      expression: `Open-circuit voltage is ${terminalBehavior.original.openVoltage} V. Short-circuit current is ${terminalBehavior.original.shortCurrent} A.` };
    const sameResistance = { kind: 'transform-resistance', resistorId: original.resistor.id,
      value: equivalent.resistor.value, expression: `The equivalent resistance is ${equivalent.resistor.value} Ω.` };
    const placement = series ? `Only ${original.source.id} and ${original.resistor.id} meet at ${original.internalNodeId}.`
      : `${original.source.id} and ${original.resistor.id} share both terminal nodes.`;
    const signNote = series ? 'The current reference points from B to A.'
      : 'The voltage reference is positive toward A.';
    const negativeNote = equivalent.source.value < 0 ? (series ? ' The negative value means current flows from A to B.'
      : ' The negative value makes A lower than B when unloaded.') : '';
    const terminalKeys = [original.source, original.resistor].flatMap(({ id: componentId, from, to }) =>
      [from, to].map(({ label }) => termKey(componentId, label)));
    steps.push({
      id, title: series ? 'Replace the series voltage source' : 'Replace the parallel current source',
      explanation: `${placement} A ${series ? 'parallel current source' : 'series voltage source'} with the same resistor preserves the voltage–current relationship at A (${a}) and B (${b}).`,
      equations: [equation, port, sameResistance], workedEquations: [equation, port, sameResistance], finalAnswer: [equation, sameResistance],
      componentIds: originalComponentIds, terminalKeys, sourceIllustration: transformation,
      sourceNote: `${signNote}${negativeNote} Positive load current leaves A. Current and power inside the pair can change.`,
    });
  }

  const reductions = relevantReductions(result);
  const reductionOrder = new Map(reductions.map(({ id }, index) => [id, index + 1]));
  for (const group of reductions) {
    const equivalentIndex = reductionOrder.get(group.id);
    const terms = group.members.map(({ id, resistance }) => ({ id, resistance, equivalentIndex: reductionOrder.get(id) }));
    const equation = {
      kind: 'reduction-group', equivalentIndex, operation: group.operation, value: group.equivalentResistance, terms,
      expression: `The ${group.operation} combination is ${group.equivalentResistance} Ω.`,
    };
    steps.push({ id: `transformed-${group.id}`, title: `Combine the equivalent ${group.operation} resistors`,
      explanation: group.operation === 'parallel'
        ? `The resistors share ${group.fromNodeId} and ${group.toNodeId}. Add their reciprocal resistances, then take the reciprocal.`
        : `Only these two resistors meet at ${group.sharedNodeId}. The same current passes through both, so add their resistances.`,
      equations: [equation], workedEquations: [equation], finalAnswer: [equation],
      componentIds: group.originalComponentIds.filter((id) => originalIds.has(id)), terminalKeys: [],
      illustration: { fromNodeId: group.fromNodeId, toNodeId: group.toNodeId, equivalentIndex,
        resistance: group.equivalentResistance, memberNames: terms.map((term) => term.equivalentIndex ? `equivalent ${term.equivalentIndex}` : term.id) },
    });
  }

  if (result.issues.length || result.verification.status !== 'verified') {
    const explanation = result.verification.status === 'mismatch'
      ? 'The full circuits failed the numerical comparison. The local terminal relationships shown above still apply.'
      : result.verification.status === 'unavailable'
        ? 'The local replacements are valid. A full numerical comparison with the equivalent circuit was unavailable.'
        : 'The replacements shown are valid. Some of the selected sources have no eligible resistor and remain in the circuit.';
    steps.push({ id: 'transformation-limits', title: 'Where the transformation stops', explanation, equations: [],
      transformationIssues: result.issues.map(({ message }) => message) });
  }

  if (result.originalResult.ok) {
    const localOnly = intent.kind === 'source-transformation' && (intent.direction || intent.target);
    const requested = intent.kind && !['general', 'source-transformation'].includes(intent.kind);
    const originalIntent = requested ? intent : { kind: 'general' };
    const originalLesson = !localOnly && buildDcLesson(graph, result.originalResult, originalIntent);
    if (originalLesson?.ok) {
      const last = originalLesson.steps.at(-1);
      const answer = answerDcQuestion(originalIntent, result.originalResult);
      const recovered = requested && originalResistorStep(result, answer, {
        currentArrowMode: last.currentArrowMode, branchFlows: last.branchFlows, currentDirections: last.currentDirections,
      });
      if (recovered) steps.push(recovered);
      else {
        if (requested) {
          steps.push(...originalLesson.steps.slice(0, -1).map((step, index) => ({
            ...step, id: `transformation-original-${step.id}`,
            ...(index === 0 ? { title: 'Set up the original circuit',
              explanation: `${step.explanation} Solve the original graph to recover the requested value.` } : {}),
          })));
        }
        steps.push({ ...last, id: 'transformation-original-results', title: requested ? last.title : 'Check the original branch currents',
          explanation: requested ? last.explanation
            : 'Use the node voltages from the nodal solve on the original circuit. Divide resistor voltage drops by resistance and use current balance for voltage-source currents.',
        });
      }
    }
    Object.assign(steps.at(-1), { allResults: result.originalResult.branches.map(branchEntry), extraEquations: [] });
  }
  return { ok: true, method: result.method, steps };
}
