import { termKey } from './electricalGraph.js';
import { answerDcQuestion } from './dcQuestions.js';

// Equivalent IDs are lesson-only. Highlights always use the original graph.
export function buildDcSeriesParallelLesson(result, intent = { kind: 'general' }) {
  if (!result?.ok || intent.kind === 'unsupported') return null;

  const byId = new Map(result.steps.map((step, index) => [step.id, { ...step, equivalentIndex: index + 1 }]));
  const original = new Map(result.initialGraph.branches.map((branch) => [branch.id, branch]));
  const reference = (id) => ({ id, equivalentIndex: byId.get(id)?.equivalentIndex });
  const name = ({ id, equivalentIndex }) => equivalentIndex ? `equivalent ${equivalentIndex}` : id;
  const steps = [];

  function add(id, title, explanation, { equations = [], componentIds = [], terminalNodes = [], ...metadata } = {}) {
    const terminals = new Set(terminalNodes);
    const terminalKeys = componentIds.flatMap((componentId) => {
      const branch = original.get(componentId);
      return [[branch.fromNodeId, branch.fromTerminal], [branch.toNodeId, branch.toTerminal]]
        .filter(([node]) => terminals.has(node)).map(([, label]) => termKey(componentId, label));
    });
    steps.push({ id, title, explanation, equations, componentIds, terminalKeys,
      ...(equations.length ? { workedEquations: equations, finalAnswer: equations } : {}),
      ...metadata,
    });
  }

  for (const [id, group] of byId) {
    const { operation, fromNodeId, toNodeId, sharedNodeId, originalComponentIds, equivalentIndex } = group;
    const terms = group.members.map(({ id: memberId, resistance }) => ({ ...reference(memberId), resistance }));
    const description = operation === 'series'
      ? `Only these two branches meet at ${sharedNodeId}. They carry the same current, so add their resistances.`
      : `These branches share nodes ${fromNodeId} and ${toNodeId}, so they have the same voltage. Add their reciprocal resistances, then take the reciprocal.`;
    add(`reduce-${id}`, `Combine resistors in ${operation}`, description, {
      equations: [{ kind: 'reduction-group', equivalentIndex, operation, value: group.equivalentResistance, terms,
        expression: `${terms.map(name).join(' and ')} give equivalent ${equivalentIndex}: ${group.equivalentResistance} Ω.` }],
      componentIds: originalComponentIds, terminalNodes: [fromNodeId, toNodeId, sharedNodeId],
      illustration: { fromNodeId, toNodeId, equivalentIndex, resistance: group.equivalentResistance, memberNames: terms.map(name) },
    });
  }

  if (result.status === 'partial') {
    const configuration = result.issues.some(({ code }) => code === 'source-configuration');
    add('partial', 'Where the reduction stops', configuration
      ? 'These replacements are valid. This method needs exactly one voltage source and no current sources to calculate a total and work back to branch results.'
      : 'The remaining network has neither resistors across the same two nodes nor two resistors alone at a shared node. The local equivalents are as far as these rules can take it.', {
      remainingNetwork: result.remainingGraph.branches.map((branch) => ({ ...branch, name: name(reference(branch.id)) })),
      nextMethodHint: 'Try Nodal Analysis or Mesh Analysis for the remaining circuit.',
    });
    return { ok: true, method: 'series-parallel-reduction', steps };
  }
  if (result.status !== 'complete') return null;

  const { source, branches, equivalentResistance } = result;
  const lessonIntent = !intent.kind || ['node-voltage', 'node-voltages'].includes(intent.kind) ? { kind: 'general' } : intent;
  const answer = answerDcQuestion(lessonIntent, { ...result, branches: [...branches, source] });
  const [load] = result.reductionTree.roots;
  const loadRef = reference(load.id);
  const loadSign = load.fromNodeId === source.fromNodeId ? 1 : -1;
  const branchFlows = [...branches, source];
  const actual = {
    currentArrowMode: 'actual', branchFlows,
    currentDirections: branchFlows.map(({ componentId, fromTerminal, toTerminal, fromNodeId, toNodeId, current }) => ({
      componentId, branchId: componentId, fromTerminal, toTerminal, fromNodeId, toNodeId, signedCurrent: current, effectivelyZero: current === 0,
    })),
  };
  const total = { kind: 'reduction-total', load: loadRef, value: equivalentResistance,
    expression: `Total resistance: ${equivalentResistance} Ω.` };
  const supply = { kind: 'reduction-source', id: source.componentId, voltage: source.voltage, unit: 'A',
    resistance: equivalentResistance, value: source.current, expression: `Source branch current: ${source.current} A.` };
  const loadValues = { kind: 'reduction-load', load: loadRef, sourceId: source.componentId, sign: loadSign,
    current: loadSign * -source.current, voltage: loadSign * source.voltage, sourceCurrent: source.current, sourceVoltage: source.voltage,
    expression: `${name(loadRef)}: ${loadSign * source.voltage} V, ${loadSign * -source.current} A from ${load.fromNodeId} to ${load.toNodeId}.` };
  const supplied = answer.kind === 'source-supply' ? {
    kind: 'source-supply', id: source.componentId, unit: 'A', value: answer.value, branchCurrent: source.current,
    expression: `Current supplied by ${source.componentId}: ${answer.value} A.`,
  } : null;
  const sourceAnswer = supplied ?? (answer.kind === 'equivalent-resistance' ? total
    : answer.branch?.componentId === load.id && answer.kind !== 'resistor-power' ? loadValues : null);
  add('source-current', 'Find the total resistance and source current',
    'Divide the source voltage by the total resistance. Current leaving the positive source terminal has the opposite sign to the source branch current.', {
    ...actual, equations: [total, supply, loadValues, ...(supplied ? [supplied] : [])], componentIds: [source.componentId],
    terminalNodes: [source.fromNodeId, source.toNodeId],
    ...(sourceAnswer ? { primaryResult: sourceAnswer } : {}),
  });

  const power = answer.kind === 'resistor-power' ? { kind: 'resistor-power', id: answer.branch.componentId,
    unit: 'W', branchVoltage: answer.branch.voltage, branchCurrent: answer.branch.current, value: answer.value,
    expression: `Power dissipated by ${answer.branch.componentId}: ${answer.value} W.` } : null;

  // Each parent equivalent is already solved when its members are restored.
  const expansions = result.backSubstitution.toSorted((a, b) => byId.get(b.id).equivalentIndex - byId.get(a.id).equivalentIndex);
  for (const expansion of expansions) {
    const group = byId.get(expansion.id);
    const parent = reference(expansion.id);
    const equations = expansion.members.map((member) => {
      const { sign, resistance } = group.members.find(({ id }) => id === member.id);
      const child = reference(member.id);
      return { kind: 'reduction-sharing', operation: expansion.operation, parent, child, sign, resistance,
        parentCurrent: expansion.current, parentVoltage: expansion.voltage, voltage: member.voltage, current: member.current,
        expression: `${name(child)}: ${member.voltage} V, ${member.current} A in its branch reference direction.` };
    });
    const target = equations.find(({ child }) => child.id === answer.branch?.componentId);
    const results = target && power ? [...equations, power] : equations;
    const sharing = expansion.operation === 'series'
      ? 'The same current goes through both members. Multiply by each resistance to find how the voltage divides.'
      : 'Every member has the same voltage across the shared nodes. Divide by each resistance to find how the current splits.';
    add(`restore-${expansion.id}`, `Undo ${name(parent)} (${expansion.operation})`, sharing, {
      ...actual, equations: results, componentIds: group.originalComponentIds,
      terminalNodes: [group.fromNodeId, group.toNodeId, group.sharedNodeId],
      ...(target ? { primaryResult: power ?? target } : {}),
    });
  }

  const results = branches.map((branch) => ({ kind: 'reduction-branch', ...branch,
    expression: `${branch.componentId} (${branch.fromTerminal} to ${branch.toTerminal}): ${branch.voltage} V, ${branch.current} A, ${branch.power} W.`,
  }));
  // With a single load, only a requested power calculation needs another operation.
  if (!expansions.length && power) {
    add('load-power', `Find the power in ${load.id}`, 'Multiply the signed voltage drop by the signed current.', {
      ...actual, equations: [power], componentIds: [load.id], terminalNodes: [load.fromNodeId, load.toNodeId],
    });
  }
  Object.assign(steps.at(-1), { allResults: results, extraEquations: [] });
  return { ok: true, method: 'series-parallel-reduction', steps };
}
