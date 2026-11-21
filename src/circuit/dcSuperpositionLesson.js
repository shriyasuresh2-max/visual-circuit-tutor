import { answerDcQuestion } from './dcQuestions.js';
import { buildDcLesson } from './dcLesson.js';

function measurementsFor(answer, { nodes, branches }) {
  const nodeVoltage = ({ id }) => ({ id, quantity: 'node-voltage', unit: 'V', label: `Voltage at ${id}` });
  const branchQuantity = (branch, quantity = 'current') => {
    const { componentId: id, fromTerminal, toTerminal } = branch;
    const label = quantity === 'supplied' ? `Current supplied by ${id}`
      : `${quantity === 'voltage' ? 'Voltage across' : 'Current through'} ${id} (${fromTerminal} → ${toTerminal})`;
    return { id, quantity, unit: quantity === 'voltage' ? 'V' : 'A', label };
  };
  switch (answer.kind) {
    case 'node-voltage': return [nodeVoltage(answer.node)];
    case 'node-voltages': return nodes.map(nodeVoltage);
    case 'branch-current': return [branchQuantity(answer.branch)];
    case 'branch-currents': return branches.map((branch) => branchQuantity(branch));
    case 'resistor-voltage': return [branchQuantity(answer.branch, 'voltage')];
    case 'source-supply': return [branchQuantity(answer.branch, 'supplied')];
    case 'resistor-power': return [branchQuantity(answer.branch, 'voltage'), branchQuantity(answer.branch)];
    default: return [...nodes.map(nodeVoltage), ...branches.map((branch) => branchQuantity(branch))];
  }
}

function indexSolution({ nodes, branches }) {
  return { potentials: new Map(nodes.map(({ id, voltage }) => [id, voltage])), byBranch: new Map(branches.map((branch) => [branch.componentId, branch])) };
}

function readMeasurement(measure, { potentials, byBranch }) {
  if (measure.quantity === 'node-voltage') return { value: potentials.get(measure.id) };
  const branch = byBranch.get(measure.id);
  const { fromNodeId, toNodeId, resistance, voltage, current, sourceVoltage } = branch;
  const reversed = measure.quantity === 'supplied' && sourceVoltage != null;
  const value = measure.quantity === 'voltage' ? voltage : reversed ? -current : current;
  return { value, fromNodeId, toNodeId, fromVoltage: potentials.get(fromNodeId), toVoltage: potentials.get(toNodeId),
    resistance, branchVoltage: voltage, branchCurrent: current, reversed };
}

function flowStep(solution, measurements, sourceCase) {
  const { potentials, byBranch } = indexSolution(solution);
  const nodeIds = new Set(measurements.filter(({ quantity }) => quantity === 'node-voltage').map(({ id }) => id));
  const ids = new Set(measurements.filter(({ quantity }) => quantity !== 'node-voltage').map(({ id }) => id));
  if (sourceCase) ids.add(sourceCase.active.componentId);
  const incident = new Map(solution.nodes.map(({ id }) => [id, 0]));
  for (const { componentId, current, fromNodeId, toNodeId } of solution.branches) {
    for (const id of [fromNodeId, toNodeId]) incident.set(id, Math.max(incident.get(id), Math.abs(current)));
    if (nodeIds.has(fromNodeId) || nodeIds.has(toNodeId)) ids.add(componentId);
  }
  const roundoff = 16 * Number.EPSILON * Math.max(1, solution.nodes.length + solution.branches.length);
  return {
    componentIds: [...ids], nodeIds: [...nodeIds],
    currentArrowMode: 'actual', branchFlows: solution.branches,
    currentDirections: [...ids].map((id) => {
      const branch = byBranch.get(id);
      const { componentId, current, fromNodeId, toNodeId, fromTerminal, toTerminal, resistance, sourceCurrent } = branch;
      const noise = resistance == null ? roundoff * Math.max(incident.get(fromNodeId), incident.get(toNodeId))
        : roundoff * Math.max(Math.abs(potentials.get(fromNodeId)), Math.abs(potentials.get(toNodeId))) / resistance;
      return { branchId: componentId, componentId, signedCurrent: current, fromNodeId, toNodeId, fromTerminal, toTerminal,
        effectivelyZero: sourceCurrent != null ? sourceCurrent === 0 : Math.abs(current) <= noise };
    }),
    ...(sourceCase ? { sourceCase } : {}),
  };
}

function measurementWork(equations) {
  const voltageIds = new Set(equations.filter(({ quantity }) => quantity === 'voltage').map(({ id }) => id));
  return equations.flatMap((entry) => entry.quantity === 'current' && entry.resistance != null && !voltageIds.has(entry.id)
    ? [{ ...entry, quantity: 'voltage', unit: 'V', value: entry.branchVoltage,
      expression: `Voltage across ${entry.id}: ${entry.branchVoltage} V.` }, entry] : [entry]);
}

function powerEntries(answer, combined) {
  const branches = answer.kind === 'resistor-power' ? [answer.branch]
    : ['general', 'superposition'].includes(answer.kind) ? combined.branches.filter(({ resistance }) => resistance != null) : [];
  return branches.map(({ componentId: id, voltage, current, power: value }) => ({
    kind: 'superposition-power', id, voltage, current, value, expression: `Power at ${id}: ${voltage} V × ${current} A = ${value} W.`,
  }));
}

export function buildDcSuperpositionLesson(result, intent, graph) {
  if (!result?.ok || result.verification?.status !== 'verified') return null;
  const { combined, contributions, sources, directResult, referenceNodeId } = result;
  const answer = answerDcQuestion(intent, { ok: true, referenceNodeId, ...combined });
  if (answer.kind === 'unsupported') return null;
  const measurements = measurementsFor(answer, combined);
  const combinedIndex = indexSolution(combined);
  const directIndex = indexSolution(directResult);
  const rows = measurements.map((measure) => ({ ...measure, terms: [] }));
  const broad = ['general', 'superposition', 'branch-currents', 'node-voltages'].includes(answer.kind);
  const featured = rows.find(({ quantity, id }) => quantity === 'current' && combinedIndex.byBranch.get(id)?.resistance != null)
    ?? rows.find(({ quantity, id }) => quantity !== 'node-voltage' || id !== referenceNodeId) ?? rows[0];
  const shown = (entry) => !broad || (entry.id === featured?.id && entry.quantity === featured?.quantity);
  const branchReference = featured?.quantity !== 'node-voltage' && combinedIndex.byBranch.get(featured?.id);
  const referenceNote = branchReference
    ? `${referenceNodeId} is 0 V. ${featured.quantity === 'supplied' && branchReference.sourceVoltage != null
      ? `Positive supplied current leaves ${featured.id}’s positive terminal.`
      : `Use ${branchReference.fromTerminal} → ${branchReference.toTerminal} as the reference for ${featured.id}.`}`
    : `Measure voltages relative to ${referenceNodeId} (0 V).`;
  const power = powerEntries(answer, combined);
  const requestedPower = answer.kind === 'resistor-power' ? power : [];
  const powerNote = 'Multiply the combined voltage and current to find power. Adding the powers from individual sources would miss how their voltages and currents interact.';
  const sourceById = new Map(sources.map((source) => [source.componentId, source]));
  const steps = contributions.map((solution) => {
    const active = sourceById.get(solution.activeSourceId);
    const inactive = solution.deactivatedSources.map((entry) => ({ ...sourceById.get(entry.componentId), ...entry }));
    const indexed = indexSolution(solution);
    const equations = rows.map((row) => {
      const { terms, ...measure } = row;
      const reading = readMeasurement(measure, indexed);
      terms.push({ sourceId: active.componentId, value: reading.value });
      return { ...measure, ...reading, kind: 'superposition-case', sourceId: active.componentId,
        expression: `${measure.label} due to ${active.componentId} is ${reading.value} ${measure.unit}.` };
    });
    const sourceCase = { active, inactive };
    const alone = sources.length === 1;
    const intro = alone ? 'There is one independent source, so its contribution is the entire response.'
      : `Keep ${active.componentId} at its stated value and turn off the other sources as shown. Use the same voltage and current references in every case.`;
    const main = equations.filter(shown);
    const nodal = graph && buildDcLesson(graph, solution, { kind: 'general' });
    const trace = nodal?.ok ? nodal.steps : [];
    const results = alone ? [...main, ...requestedPower] : main;
    return { id: `contribution-${active.componentId}`, title: `Contribution from ${active.componentId}`,
      explanation: intro, referenceNote,
      equations: alone ? [...equations, ...power] : equations, workedEquations: [...measurementWork(main), ...(alone ? requestedPower : [])],
      finalAnswer: results, primaryResult: alone ? requestedPower[0] : undefined,
      ...(alone && power.length ? { powerNote: 'Multiply the full circuit voltage and current to find power. In this circuit, one source provides the entire response.' } : {}),
      caseDerivation: trace,
      ...(broad ? { allResults: equations.filter((entry) => !shown(entry)), extraEquations: [] } : {}),
      ...(alone && broad && power.length ? { extraEquations: power } : {}),
      ...flowStep(solution, main, sourceCase) };
  });
  if (sources.length === 1) return { ok: true, method: 'superposition', steps };

  const totals = rows.map((row) => {
    const { value } = readMeasurement(row, combinedIndex);
    return { ...row, kind: 'superposition-sum', value, directValue: readMeasurement(row, directIndex).value,
      expression: `${row.label}: ${row.terms.map((term) => `(${term.value} ${row.unit})`).join(' + ') || '0'} = ${value} ${row.unit}.` };
  });
  const equations = [...totals, ...power];
  const main = totals.filter(shown);
  const results = [...main, ...requestedPower];
  steps.push({ id: 'superposition-combined', title: sources.length ? 'Add the signed contributions' : 'Read the passive circuit result',
    explanation: sources.length ? 'Add each value with its sign. The totals agree with the original circuit solved by Nodal Analysis.'
      : 'There are no independent sources. The verified passive circuit has zero voltage and current.',
    equations, workedEquations: results, finalAnswer: results, primaryResult: requestedPower[0],
    ...(sources.length ? { contributionTable: { sourceIds: sources.map(({ componentId }) => componentId), entries: totals } } : {}),
    ...(power.length ? { powerNote } : {}),
    ...(broad ? { allResults: totals.filter((entry) => !shown(entry)), extraEquations: power } : {}),
    ...flowStep(combined, main),
  });
  return { ok: true, method: 'superposition', steps };
}
