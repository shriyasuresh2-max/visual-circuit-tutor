import { answerDcQuestion } from './dcQuestions.js';
import { currentSourceDirection, termKey } from './electricalGraph.js';
import { lessonNumber as displayed } from './dcLessonMath.js';

const voltage = (id) => `V[${id}]`;
const current = (id) => `I[${id}]`;
const volts = (value) => `${value} V`;
const unique = (values) => [...new Set(values)];
const endpoints = (branch) => [branch.fromNodeId, branch.toNodeId];

function direction(branch) {
  const { componentId, fromNodeId, toNodeId, fromTerminal, toTerminal } = branch;
  return { branchId: componentId, componentId, fromNodeId, toNodeId, fromTerminal, toTerminal };
}

function matchesGraph(graph, result) {
  if (graph?.incomplete || graph?.reconstruction_incomplete || graph?.provisional?.length ||
      graph?.validation?.isValid === false || graph?.topology?.provisional?.length ||
      graph?.topology?.edges?.some((edge) => edge.confirmed === false) ||
      graph?.nodes?.length !== result.nodes.length || graph?.components?.length !== result.branches.length) return false;
  const nodes = new Map(graph.nodes.map((node) => [node.id, new Set(node.members)]));
  const components = new Map(graph.components.map((component) => [component.id, component]));
  return nodes.has(result.referenceNodeId) && result.nodes.every((node) => nodes.has(node.id)) &&
    result.branches.every((branch) => {
      const component = components.get(branch.componentId);
      if (branch.sourceCurrent != null) {
        const arrow = component && currentSourceDirection(component);
        if (arrow?.fromTerminal !== branch.fromTerminal || arrow?.toTerminal !== branch.toTerminal) return false;
      }
      return component?.type === branch.type && [
        [branch.fromTerminal, branch.fromNodeId], [branch.toTerminal, branch.toNodeId],
      ].every(([label, nodeId]) =>
        component.terminals.some((terminal) => terminal.label === label && terminal.node === nodeId) &&
        nodes.get(nodeId)?.has(termKey(component.id, label)));
    });
}

/** Terms use the passive directions in the solver. A resistor tied to the
 * same node at both ends has a zero stamp and contributes no KCL term. */
function kclRows(nodes, branches, reference) {
  const termsByNode = new Map(nodes.map(({ id }) => [id, []]));
  for (const branch of branches) {
    if (branch.fromNodeId === branch.toNodeId) continue;
    const term = { ...direction(branch), resistance: branch.resistance ?? null, sourceCurrent: branch.sourceCurrent };
    termsByNode.get(branch.fromNodeId).push({ ...term, sign: 1 });
    termsByNode.get(branch.toNodeId).push({ ...term, sign: -1 });
  }
  return nodes.filter(({ id }) => id !== reference).map(({ id }) => ({ nodeId: id, terms: termsByNode.get(id) }));
}

function kclEquation(row, reference, substituted) {
  const potential = (id) => substituted && id === reference ? '0 V' : voltage(id);
  const expression = row.terms.map((term, i) => {
    const body = substituted && term.sourceCurrent != null ? `(${term.sourceCurrent} A)`
      : term.resistance == null ? current(term.branchId) :
      `(${potential(term.fromNodeId)} − ${potential(term.toNodeId)}) / ${substituted ? `(${term.resistance} Ω)` : `R[${term.branchId}]`}`;
    return term.sign < 0 ? `${i ? ' − ' : '−'}${body}` : `${i ? ' + ' : ''}${body}`;
  }).join('') || '0 A';
  return { kind: 'kcl', ...row, referenceNodeId: reference, substituted, equals: 0, unit: 'A', expression: `${expression} = 0 A` };
}

function sourceConstraint(branch, reference, substituted = false) {
  const potential = (id) => substituted && id === reference ? '0 V' : voltage(id);
  return {
    kind: 'source-constraint', ...direction(branch),
    equals: branch.sourceVoltage, unit: 'V', substituted,
    expression: `${potential(branch.fromNodeId)} − ${potential(branch.toNodeId)} = ${volts(branch.sourceVoltage)}`,
  };
}

function resultEntry(kind, id, value, unit, label, expression, branch = null) {
  return {
    kind, id, value, unit, label, expression,
    ...(branch ? {
      direction: direction(branch), resistance: branch.resistance,
      branchVoltage: branch.voltage, branchCurrent: branch.current, sourceCurrent: branch.sourceCurrent,
    } : {}),
  };
}

function nodeEntry(node) {
  return resultEntry('node-voltage', node.id, node.voltage, 'V', voltage(node.id),
    `${voltage(node.id)} ≈ ${volts(displayed(node.voltage))}`);
}

function branchEntry(branch, kind, value) {
  const id = branch.componentId;
  const drop = `ΔV[${id}]`;
  const i = current(id);
  switch (kind) {
    case 'branch-current':
      return resultEntry(kind, id, value, 'A', i,
        branch.sourceCurrent != null ? `${i} = ${value} A`
          : branch.resistance == null ? `${i} ≈ ${displayed(value)} A`
          : `${i} = ${drop} / R[${id}] ≈ ${volts(displayed(branch.voltage))} / (${branch.resistance} Ω) ≈ ${displayed(value)} A`, branch);
    case 'source-supply':
      if (branch.sourceCurrent != null) return branchEntry(branch, 'branch-current', value);
      return {
        ...resultEntry(kind, id, value, 'A', `Supplied current from ${id}`,
          `I_supplied[${id}] = −${i} ≈ −(${displayed(branch.current)} A) ≈ ${displayed(value)} A`, branch),
        direction: direction({
          componentId: id,
          fromNodeId: branch.toNodeId, toNodeId: branch.fromNodeId,
          fromTerminal: branch.toTerminal, toTerminal: branch.fromTerminal,
        }),
      };
    case 'resistor-voltage':
      return resultEntry(kind, id, value, 'V', drop,
        `${drop} = ${voltage(branch.fromNodeId)} − ${voltage(branch.toNodeId)} ≈ ${volts(displayed(value))}`, branch);
    case 'resistor-power':
      return resultEntry(kind, id, value, 'W', `P[${id}]`,
        `P[${id}] = ${drop} × ${i} ≈ (${volts(displayed(branch.voltage))}) × (${displayed(branch.current)} A) ≈ ${displayed(value)} W`, branch);
    default:
      return null;
  }
}

function selectEntries(answer, result) {
  const nodeValues = result.nodes.map(nodeEntry);
  const branchCurrents = () => result.branches.map((branch) => branchEntry(branch, 'branch-current', branch.current));
  if (answer.kind === 'general') return [...nodeValues, ...branchCurrents()];
  if (answer.kind === 'branch-currents') return branchCurrents();
  if (answer.kind === 'node-voltages') return nodeValues;
  if (answer.kind === 'node-voltage') return [nodeEntry(answer.node)];
  return [branchEntry(answer.branch, answer.kind, answer.value)];
}

/**
 * Explain one successful, matching DC solve. Branch IDs are component IDs in
 * the electrical graph. All references identify electrical entities, never
 * rendered segments or drawing coordinates.
 */
export function buildDcLesson(graph, result, intent) {
  if (!intent || !result?.ok || !matchesGraph(graph, result)) {
    return { ok: false, message: 'A verified DC solution is required for these steps.', steps: [] };
  }
  const answer = answerDcQuestion(intent, result);
  if (answer.kind === 'unsupported') return { ok: false, message: answer.message, steps: [] };

  const { nodes, branches, referenceNodeId: reference } = result;
  const sources = branches.filter((branch) => branch.sourceVoltage != null);
  const currentSources = branches.filter((branch) => branch.sourceCurrent != null);
  const unknowns = nodes.filter((node) => node.id !== reference);
  const rows = kclRows(nodes, branches, reference);
  const allNodes = nodes.map(({ id }) => id);
  const entries = selectEntries(answer, result);
  const targetNodes = unique(entries.flatMap((entry) => entry.direction
    ? [entry.direction.fromNodeId, entry.direction.toNodeId]
    : [entry.id, reference]));
  const targetBranches = branches.filter((branch) => entries.some((entry) => entry.direction?.branchId === branch.componentId));
  const branchById = new Map(branches.map((branch) => [branch.componentId, branch]));
  const potentials = new Map(nodes.map((node) => [node.id, node.voltage]));
  const incidentCurrent = new Map(nodes.map((node) => [node.id, Math.max(0, ...node.currents.map((term) => Math.abs(term.currentLeaving)))]));
  const roundoff = 16 * Number.EPSILON * Math.max(1, unknowns.length + sources.length);
  const referenceArrowSteps = new Set(['reference', 'directions', 'kcl', 'constraints', 'substitute']);
  const steps = [];
  function add(id, title, explanation, equations, nodeIds, relevantBranches, finalAnswer) {
    const ids = relevantBranches.map((branch) => branch.componentId);
    const directions = finalAnswer
      ? finalAnswer.flatMap((entry) => entry.direction ? [entry.direction] : [])
      : relevantBranches.map(direction);
    const currentArrowMode = id === 'solve' || id === 'answer' ? 'actual'
      : referenceArrowSteps.has(id) ? 'reference' : null;
    steps.push({
      id, title, explanation, equations, nodeIds: unique(nodeIds),
      componentIds: ids, branchIds: ids, wireIds: [],
      currentArrowMode,
      currentDirections: currentArrowMode === 'actual' ? directions.map((arrow) => {
        const branch = branchById.get(arrow.branchId);
        const sign = arrow.fromTerminal === branch.fromTerminal ? 1 : -1;
        const noise = branch.resistance == null
          ? roundoff * Math.max(...endpoints(branch).map((node) => incidentCurrent.get(node)))
          : roundoff * Math.max(...endpoints(branch).map((node) => Math.abs(potentials.get(node)))) / branch.resistance;
        return {
          ...arrow, signedCurrent: sign * branch.current,
          effectivelyZero: branch.sourceCurrent != null ? branch.sourceCurrent === 0 : Math.abs(branch.current) <= noise,
        };
      }) : directions,
      ...(finalAnswer ? { finalAnswer } : {}),
    });
  }
  const answerLabel = entries.length === 1 ? entries[0].label : {
    'branch-currents': 'the branch currents',
    'node-voltages': 'the node voltages',
    general: 'the node voltages and branch currents',
  }[answer.kind];
  add('identify', 'Identify the circuit quantities',
    `Find ${answerLabel}. Start by tracing which component terminals share each of the ${nodes.length} electrical nodes.`,
    [], allNodes, branches);
  add('reference', 'Set the reference and unknowns',
    `Set ${reference} to 0 V so every other voltage has the same reference. The remaining node voltages and any voltage-source currents are unknowns.`,
    [{ kind: 'reference', nodeId: reference, value: 0, unit: 'V', expression: `${voltage(reference)} = 0 V` },
      ...unknowns.map(({ id }) => ({ kind: 'unknown-voltage', nodeId: id, expression: `${voltage(id)} is unknown` })),
      ...sources.map((branch) => ({ kind: 'unknown-current', branchId: branch.componentId, expression: `${current(branch.componentId)} is unknown` }))],
    allNodes, sources);
  add('directions', 'Set current reference directions',
    currentSources.length
      ? 'For current sources, use the declared reference arrows. A negative specified current flows against its arrow.'
        + (sources.length ? ' A voltage source’s reference current enters its positive terminal.' : '')
      : 'Give each current an arrow so we can keep track of its sign. A negative answer means the current flows the other way; the source’s reference arrow enters its positive terminal.',
    branches.map((branch) => ({ kind: 'current-direction', ...direction(branch),
      expression: `${current(branch.componentId)}: ${branch.fromNodeId} (${branch.fromTerminal}) → ${branch.toNodeId} (${branch.toTerminal})` })),
    allNodes, branches);
  if (rows.length) {
    add('kcl', 'Apply Kirchhoff’s current law',
      'What flows into each node must flow out, so the signed sum of currents leaving is zero. '
        + (currentSources.length ? 'Add the given current at the reference arrow’s tail and subtract it at the head. ' : '')
        + 'Use Ohm’s law for resistors.'
        + (sources.length ? ' Leave voltage-source currents as unknowns.' : ''),
      rows.map((row) => kclEquation(row, reference, false)), allNodes, branches);
  }
  if (sources.length) {
    add('constraints', 'Apply voltage-source constraints',
      'An ideal voltage source fixes the difference between its two terminal voltages. Write the positive-terminal voltage minus the negative-terminal voltage.',
      sources.map((source) => sourceConstraint(source, reference)), sources.flatMap(endpoints), sources);
  }
  if (rows.length || sources.length) {
    add('substitute', 'Substitute known values',
      'Put the known component values into the equations. Use 0 V wherever the reference node appears.',
      [...rows.map((row) => kclEquation(row, reference, true)),
        ...sources.map((source) => sourceConstraint(source, reference, true))], allNodes, branches);
  }
  add('solve', 'Solve the simultaneous equations',
    (sources.length ? 'Solve the current-balance and voltage-source equations together. ' : 'Solve the current-balance equations for the node voltages. ')
      + 'The resulting voltage drops let us calculate the resistor currents.',
    [...nodes.map(nodeEntry), ...[...sources, ...currentSources].map((branch) => branchEntry(branch, 'branch-current', branch.current))],
    allNodes, branches);
  const answerPresentation = {
    'branch-current': [`Calculate current through ${answer.branch?.componentId}`, answer.branch?.sourceCurrent != null
      ? 'Use the specified signed current. Positive follows the source’s reference arrow.'
      : answer.branch?.resistance == null
      ? 'Use the source current found by solving the equations. Its sign follows the reference arrow.'
      : 'Divide the resistor’s voltage drop by its resistance. The sign tells you whether the current follows the reference arrow.'],
    'source-supply': ['Find the current supplied', answer.branch?.sourceCurrent != null
      ? 'Use the specified signed current in the direction of the source’s reference arrow.'
      : 'Report current leaving the positive terminal. That reverses the sign of the source current in the equations.'],
    'resistor-voltage': [`Find the voltage across ${answer.branch?.componentId}`, 'Subtract the voltage at the second terminal from the first to get the voltage drop.'],
    'resistor-power': [`Calculate power dissipated by ${answer.branch?.componentId}`, 'Multiply the resistor’s voltage drop by its current to find the power it dissipates.'],
    'node-voltage': ['Read the node voltage', 'Use the voltage found by solving the equations. It is measured from the reference node.'],
    'node-voltages': ['Read the node voltages', 'Read each solved voltage relative to the reference node at 0 V.'],
    'branch-currents': ['Find the branch currents', 'Use the specified currents for current sources, the solved currents for voltage sources, and Ohm’s law for resistors. A negative current flows against its reference arrow.'],
    general: ['Read the circuit solution', 'Read the node voltages relative to 0 V. Use the voltage drops to find resistor currents, with signs measured against the reference arrows.'],
  };
  const [answerTitle, answerExplanation] = answerPresentation[answer.kind];
  add('answer', answerTitle, answerExplanation,
    entries, targetNodes, targetBranches, entries);
  return { ok: true, method: 'modified-nodal-analysis', steps };
}
