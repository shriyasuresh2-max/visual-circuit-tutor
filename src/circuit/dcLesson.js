import { answerDcQuestion } from './dcQuestions.js';
import { currentSourceDirection, termKey } from './electricalGraph.js';
import { lessonNumber as displayed } from './dcLessonMath.js';
import { nodalPotentials, traceNodalAlgebra } from './dcNodalAlgebra.js';

const voltage = (id) => `V[${id}]`;
const current = (id) => `I[${id}]`;
const volts = (value) => `${value} V`;
const unique = (values) => [...new Set(values)];
const endpoints = (branch) => [branch.fromNodeId, branch.toNodeId];

function direction(branch) {
  const { componentId, fromNodeId, toNodeId, fromTerminal, toTerminal } = branch;
  return { branchId: componentId, componentId, fromNodeId, toNodeId, fromTerminal, toTerminal };
}

const kclTerm = (branch) => ({
  ...direction(branch), resistance: branch.resistance ?? null, sourceCurrent: branch.sourceCurrent,
});

function matchesGraph(graph, result) {
  if (graph?.incomplete || graph?.reconstruction_incomplete || graph?.provisional?.length ||
      graph?.validation?.isValid === false || graph?.topology?.provisional?.length ||
      graph?.topology?.edges?.some((edge) => edge.confirmed === false) ||
      graph?.nodes?.length !== result.nodes.length || graph?.components?.filter(({ type }) => type !== 'ground').length !== result.branches.length) return false;
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
    const term = kclTerm(branch);
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
    equals: branch.sourceVoltage, unit: 'V', substituted, referenceNodeId: reference,
    expression: `${potential(branch.fromNodeId)} − ${potential(branch.toNodeId)} = ${volts(branch.sourceVoltage)}`,
  };
}

/** Maximal voltage-source groups. A group touching the reference has fixed
 * potentials from its source constraints, so it needs no floating-group KCL. */
function findSupernodes(nodes, branches, sources, reference, potentials, roundoff) {
  const adjacent = new Map(nodes.map(({ id }) => [id, []]));
  for (const source of sources) {
    for (const id of endpoints(source)) adjacent.get(id).push(source);
  }
  const seen = new Set();
  const groups = [];
  for (const [id, incident] of adjacent) {
    if (seen.has(id) || !incident.length) continue;
    const nodeIds = [id];
    seen.add(id);
    const internal = new Set();
    for (const member of nodeIds) {
      for (const source of adjacent.get(member)) {
        internal.add(source);
        const neighbor = source.fromNodeId === member ? source.toNodeId : source.fromNodeId;
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        nodeIds.push(neighbor);
      }
    }
    const members = new Set(nodeIds);
    if (members.has(reference)) continue;
    const boundary = branches.filter(({ fromNodeId, toNodeId }) => members.has(fromNodeId) !== members.has(toNodeId));
    const terms = boundary.map((branch) => ({ ...kclTerm(branch), sign: members.has(branch.fromNodeId) ? 1 : -1 }));
    const boundaryCurrents = terms.map(({ sign, resistance, sourceCurrent, fromNodeId, toNodeId }) =>
      sign * (resistance == null ? sourceCurrent : (potentials.get(fromNodeId) - potentials.get(toNodeId)) / resistance));
    const kclResidual = boundaryCurrents.reduce((sum, value) => sum + value, 0);
    // Allow the rounding already present in each member's verified MNA KCL
    // row, including subtraction of near-equal resistor terminal voltages.
    let tolerance = 0;
    for (const member of nodes.filter(({ id: nodeId }) => members.has(nodeId))) {
      tolerance += 1e-9 * member.currents.reduce((max, term) => Math.max(max, Math.abs(term.currentLeaving)), 0);
    }
    for (const branch of branches) {
      if (branch.resistance == null || branch.fromNodeId === branch.toNodeId) continue;
      for (const end of endpoints(branch)) {
        if (members.has(end)) tolerance += roundoff * Math.max(...endpoints(branch).map((node) => Math.abs(potentials.get(node)))) / branch.resistance;
      }
    }
    const sourceResiduals = [...internal].map((source) => {
      const [from, to] = endpoints(source).map((node) => potentials.get(node));
      const residual = from - to - source.sourceVoltage;
      const limit = source.sourceVoltage === 0 ? roundoff * Math.max(Math.abs(from), Math.abs(to)) : 1e-9 * Math.abs(source.sourceVoltage);
      return { componentId: source.componentId, residual, valid: Number.isFinite(residual) && Math.abs(residual) <= limit };
    });
    // A voltage-source cycle would give dependent or inconsistent constraints.
    if (internal.size !== nodeIds.length - 1 || !Number.isFinite(kclResidual) ||
        !Number.isFinite(tolerance) || Math.abs(kclResidual) > tolerance || sourceResiduals.some(({ valid }) => !valid)) return null;
    groups.push({ nodeIds, sources: [...internal], boundary, terms, kclResidual, sourceResiduals });
  }
  return groups;
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

function sourceCurrentEquation(source, sources, branches) {
  const side = new Set([source.fromNodeId]);
  const pending = [source.fromNodeId];
  for (const node of pending) {
    for (const branch of sources) {
      if (branch === source || !endpoints(branch).includes(node)) continue;
      const next = branch.fromNodeId === node ? branch.toNodeId : branch.fromNodeId;
      if (side.has(next)) continue;
      side.add(next);
      pending.push(next);
    }
  }
  // Adding KCL within this set cancels its internal source currents. The
  // requested source is the only voltage source that crosses the cut.
  const terms = branches.filter((branch) => branch !== source && side.has(branch.fromNodeId) !== side.has(branch.toNodeId))
    .map((branch) => ({ ...kclTerm(branch), sign: side.has(branch.fromNodeId) ? -1 : 1, value: branch.current }));
  return { kind: 'nodal-source-current', id: source.componentId, nodeIds: [...side], terms, value: source.current,
    unit: 'A', expression: `Current through ${source.componentId} balances the other currents crossing these nodes.` };
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
  if (intent.method === 'mesh') {
    return { ok: false, message: 'Select Mesh Analysis for this question.', steps: [] };
  }
  const answer = answerDcQuestion(intent, result);
  if (answer.kind === 'unsupported') return { ok: false, message: answer.message, steps: [] };

  const { nodes, branches, referenceNodeId: reference } = result;
  const sources = branches.filter((branch) => branch.sourceVoltage != null);
  const unknowns = nodes.filter((node) => node.id !== reference);
  const allNodes = nodes.map(({ id }) => id);
  const potentials = new Map(nodes.map((node) => [node.id, node.voltage]));
  const roundoff = 16 * Number.EPSILON * Math.max(1, unknowns.length + sources.length);
  const supernodes = findSupernodes(nodes, branches, sources, reference, potentials, roundoff);
  if (!supernodes) return { ok: false, message: 'The supernode equations could not be verified against the nodal solution.', steps: [] };
  const supernodeNodeIds = supernodes.flatMap(({ nodeIds }) => nodeIds);
  const supernodeSourceIds = supernodes.flatMap(({ sources: groupSources }) => groupSources.map(({ componentId }) => componentId));
  const boundaryBranches = unique(supernodes.flatMap(({ boundary }) => boundary));
  const relations = nodalPotentials(nodes, sources, reference);
  const knownPotentials = Object.fromEntries([...relations].filter(([, { variable }]) => variable == null).map(([id, { offset }]) => [id, offset]));
  const rows = kclRows(nodes, branches, reference).filter(({ nodeId }) =>
    !supernodeNodeIds.includes(nodeId) && !Object.hasOwn(knownPotentials, nodeId));
  const reducedRows = [...rows, ...supernodes.map(({ nodeIds, terms }) => ({
    nodeId: relations.get(nodeIds[0]).variable, terms,
  }))];
  const algebra = traceNodalAlgebra(reducedRows, relations, potentials);
  const anchored = [...relations].filter(([, { variable, componentId }]) => variable == null && componentId);
  const ordinarySources = anchored.map(([, { componentId }]) => sources.find((source) => source.componentId === componentId));
  const isSupernodeQuestion = answer.kind === 'supernode';
  const noSupernodeMessage = 'There is no floating voltage-source group. Ordinary nodal analysis is sufficient. '
    + (sources.length ? 'The reference node fixes the voltages in each connected voltage-source group.' : 'There are no ideal voltage sources between nonreference nodes.');
  const entries = isSupernodeQuestion ? [
    ...nodes.filter(({ id }) => supernodeNodeIds.includes(id)).map(nodeEntry),
    ...unique([...boundaryBranches, ...sources.filter(({ componentId }) => supernodeSourceIds.includes(componentId))])
      .map((branch) => branchEntry(branch, 'branch-current', branch.current)),
  ] : selectEntries(answer, result);
  const targetNodes = unique(entries.flatMap((entry) => entry.direction
    ? [entry.direction.fromNodeId, entry.direction.toNodeId]
    : [entry.id, reference]));
  const targetBranches = branches.filter((branch) => entries.some((entry) => entry.direction?.branchId === branch.componentId));
  const branchById = new Map(branches.map((branch) => [branch.componentId, branch]));
  const incidentCurrent = new Map(nodes.map((node) => [node.id, Math.max(0, ...node.currents.map((term) => Math.abs(term.currentLeaving)))]));
  const steps = [];
  function add(id, title, explanation, equations, nodeIds, relevantBranches, finalAnswer, metadata = {}) {
    const ids = relevantBranches.map((branch) => branch.componentId);
    const directions = id === 'answer' && finalAnswer
      ? finalAnswer.flatMap((entry) => entry.direction ? [entry.direction] : [])
      : relevantBranches.map(direction);
    const currentArrowMode = id === 'solve' || id === 'answer' ? 'actual'
      : (id === 'reference' || id.startsWith('constraints') || id.startsWith('kcl') || metadata.supernodeNodeIds) ? 'reference' : null;
    steps.push({
      id, title, explanation, equations, nodeIds: unique(nodeIds),
      ...metadata,
      componentIds: ids, branchIds: ids, wireIds: [],
      currentArrowMode,
      ...(currentArrowMode === 'actual' ? { branchFlows: branches } : {}),
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
  add('reference', 'Label the nodes and choose 0 V',
    `Follow each continuous wire to find the ${nodes.length} nodes, then set ${reference} to 0 V. A negative current flows against its reference arrow.`,
    [{ kind: 'reference', nodeId: reference, value: 0, unit: 'V', expression: `${voltage(reference)} = 0 V` },
      ...unknowns.filter(({ id }) => !Object.hasOwn(knownPotentials, id)).map(({ id }) =>
        ({ kind: 'unknown-voltage', nodeId: id, expression: `${voltage(id)} is unknown` }))],
    allNodes, branches, null, {
      directionEquations: branches.map((branch) => ({ kind: 'current-direction', ...direction(branch),
        expression: `${current(branch.componentId)}: ${branch.fromTerminal} → ${branch.toTerminal}` })),
    });
  for (let index = 0; index < ordinarySources.length; index += 2) {
    const group = ordinarySources.slice(index, index + 2);
    const fixed = anchored.slice(index, index + group.length);
    const equations = group.map((source) => sourceConstraint(source, reference));
    add(index ? `constraints-${index / 2 + 1}` : 'constraints', `Use ${group.map(({ componentId }) => componentId).join(' and ')} to find node voltages`,
      'Each voltage source fixes its positive terminal minus its negative terminal. Start from 0 V to find the connected node voltages.',
      equations, group.flatMap(endpoints), group,
      fixed.map(([id]) => nodeEntry({ id, voltage: potentials.get(id) })),
      { workedEquations: equations.map((equation, i) => ({ ...equation, staged: true,
        knownPotentials: { [fixed[i][1].parent]: knownPotentials[fixed[i][1].parent] },
        substitutionExpression: sourceConstraint(group[i], reference, true).expression })) });
  }
  const workedKcl = (row, equations) => ({ ...equations, staged: true, knownPotentials,
    substitutionExpression: kclEquation(row, reference, true).expression });
  for (let index = 0; index < rows.length; index += 2) {
    const group = rows.slice(index, index + 2);
    const nodeIds = group.map(({ nodeId }) => nodeId);
    const relevantBranches = unique(group.flatMap(({ terms }) => terms.map(({ branchId }) => branchById.get(branchId))));
    const equations = group.map((row) => kclEquation(row, reference, false));
    add(index === 0 ? 'kcl' : `kcl-${index / 2 + 1}`, `Balance current at ${nodeIds.join(' and ')}`,
      'Current entering a node equals current leaving it. Use the arrows for signs and divide each resistor’s voltage drop by its resistance.',
      equations, nodeIds, relevantBranches, null,
      { workedEquations: equations.map((equation, i) => workedKcl(group[i], equation)) });
  }
  supernodes.forEach(({ nodeIds, sources: groupSources, boundary, terms }, index) => {
    const equations = [kclEquation({ nodeIds, terms }, reference, false),
      ...groupSources.map((source) => sourceConstraint(source, reference))];
    const sourceNames = groupSources.map(({ componentId }) => componentId).join(', ');
    const sourceSubject = groupSources.length === 1 ? `Source ${sourceNames} connects` : `Sources ${sourceNames} connect`;
    add(`supernode-${index + 1}`, `Apply KCL to supernode ${index + 1}`,
      `${sourceSubject} nodes ${nodeIds.join(', ')}. The unknown source currents cancel inside the group, so balance the boundary currents and use the source voltages to relate its nodes.`,
      equations, nodeIds, [...groupSources, ...boundary], nodeIds.flatMap((id) => {
        const { variable, offset } = relations.get(id);
        return id === variable ? [] : [{ kind: 'nodal-potential', id, variable, offset,
          expression: `V[${id}] = V[${variable}] + (${offset} V)` }];
      }), {
        supernodeNodeIds: nodeIds,
        supernodeSourceIds: groupSources.map(({ componentId }) => componentId),
        workedEquations: equations.map((equation, equationIndex) => equationIndex === 0
          ? workedKcl({ nodeIds, terms }, equation) : { ...equation, staged: true,
            substitutionExpression: sourceConstraint(groupSources[equationIndex - 1], reference, true).expression }),
      });
  });
  if (algebra?.elimination.length) {
    add('collect', 'Collect the voltage terms',
      'Replace the related node voltages, then group terms that use the same unknown.', algebra.original, allNodes, []);
    for (const { variable, equations } of algebra.elimination) {
      add(`eliminate-${variable}`, `Eliminate ${variable} from later equations`,
        'Subtract a multiple of an earlier equation so this voltage cancels.', equations, [variable, ...equations.flatMap(({ terms }) => terms.map(({ id }) => id))], []);
    }
  }
  if (reducedRows.length) {
    const equations = algebra?.backSubstitution ?? [];
    const related = [...relations].filter(([id, { variable }]) => variable != null && variable !== id)
      .map(([id, { variable, offset }]) => ({ kind: 'nodal-potential', id, variable, offset, baseVoltage: potentials.get(variable),
        expression: `Use V[${variable}] and the source offset to find V[${id}].` }));
    add('solve', reducedRows.length === 1 ? 'Find the unknown voltage' : 'Find the remaining voltages',
      algebra ? (algebra.elimination.length ? 'Use the last equation first, then work upward to find each voltage.'
        : 'Collect the voltage terms and divide by the coefficient of each unknown.')
        : 'Use the displayed equations to find the voltages. The simplified calculation is unavailable at this numerical scale.',
      equations, allNodes, branches, unknowns.filter(({ id }) => !Object.hasOwn(knownPotentials, id)).map(nodeEntry),
      { workedEquations: [...(algebra?.elimination.length ? [] : algebra?.original ?? []), ...equations, ...related] });
  }
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
    supernode: ['Read the supernode results', 'Read each voltage relative to the reference node. Positive branch current follows the indicated reference direction.'],
  };
  const [answerTitle, answerExplanation] = answerPresentation[answer.kind];
  const allCurrents = branches.map((branch) => branchEntry(branch, 'branch-current', branch.current));
  const sourceEquations = sources.map((source) => sourceCurrentEquation(source, sources, branches));
  const measuredSources = sourceEquations.filter(({ id }) => targetBranches.some((branch) => branch.componentId === id) &&
    entries.some((entry) => entry.id === id && entry.unit === 'A'));
  const answerEntries = answer.kind === 'general' || !entries.length ? allCurrents : entries;
  const currentSummary = answer.kind === 'general' || !entries.length;
  const answerWorks = [...(currentSummary ? sourceEquations : measuredSources), ...answerEntries];
  const currentExplanation = [
    branches.some(({ resistance }) => resistance != null) && 'Divide each resistor’s voltage drop by its resistance.',
    sources.length ? 'Use current balance to find the voltage-source currents.'
      : branches.some(({ sourceCurrent }) => sourceCurrent != null) && 'Use the given current for each current source.',
  ].filter(Boolean).join(' ');
  add(currentSummary && !reducedRows.length ? 'solve' : 'answer', currentSummary ? 'Find the branch currents' : answerTitle,
    currentSummary ? currentExplanation : answerExplanation,
    answerWorks, currentSummary ? allNodes : targetNodes, currentSummary ? branches : targetBranches, answerEntries,
    { workedEquations: answerWorks, allResults: [...nodes.map(nodeEntry), ...allCurrents],
      extraEquations: currentSummary ? [] : sourceEquations.filter((equation) => !measuredSources.includes(equation)),
      ...(isSupernodeQuestion && supernodes.length ? { supernodeNodeIds, supernodeSourceIds } : {}) });
  return { ok: true, method: 'modified-nodal-analysis', steps, supernodes, ...(isSupernodeQuestion && !supernodes.length ? { noSupernodeMessage } : {}) };
}
