import { answerDcQuestion } from './dcQuestions.js';
import { traceMeshAlgebra } from './dcMeshAlgebra.js';

function nodeVoltageEntries(result) {
  const { referenceNodeId, nodes, branches } = result;
  const adjacent = new Map(nodes.map(({ id }) => [id, []]));
  // An ideal current source does not prescribe a voltage drop for this walk.
  for (const { componentId, fromNodeId, toNodeId, sourceCurrent, voltage } of branches) {
    if (sourceCurrent != null) continue;
    adjacent.get(fromNodeId).push({ next: toNodeId, componentId, voltage, sign: -1 });
    adjacent.get(toNodeId).push({ next: fromNodeId, componentId, voltage, sign: 1 });
  }
  const paths = new Map([[referenceNodeId, []]]);
  for (const [id, path] of paths) {
    for (const { next, ...term } of adjacent.get(id)) {
      if (!paths.has(next)) paths.set(next, [...path, term]);
    }
  }
  return nodes.map(({ id, voltage }) => ({ kind: 'mesh-node-voltage', nodeId: id, referenceNodeId, unit: 'V',
    terms: paths.get(id), value: voltage, expression: `Voltage at ${id}: ${voltage} V relative to ${referenceNodeId}.` }));
}

function requestedCalculation(answer, result, branchCurrents, nodeEntries) {
  const selectedNodes = answer.node ? nodeEntries.filter(({ nodeId }) => nodeId === answer.node.id)
    : answer.kind === 'node-voltages' ? nodeEntries : [];
  if (selectedNodes.length) {
    return {
      title: answer.node ? `Find the voltage at ${answer.node.id}` : 'Find the node voltages',
      explanation: `Start at ${result.referenceNodeId} (0 V). Add the signed voltage changes along a connected path.`,
      finalAnswer: selectedNodes, workedEquations: selectedNodes,
      componentIds: [...new Set(selectedNodes.flatMap(({ terms }) => terms.map(({ componentId }) => componentId)))],
      nodeIds: [...new Set([result.referenceNodeId, ...selectedNodes.map(({ nodeId }) => nodeId)])],
    };
  }
  const branch = answer.branch;
  if (!branch) return null;
  const id = branch.componentId;
  const current = branchCurrents.find(({ componentId }) => componentId === id);
  const target = {
    title: `Find the current through ${id}`,
    explanation: `Add the signed loop currents through ${id}. A positive result goes from ${branch.fromTerminal} to ${branch.toTerminal}.`,
    finalAnswer: [current], workedEquations: [current], componentIds: [id], nodeIds: [branch.fromNodeId, branch.toNodeId],
  };
  if (answer.kind === 'resistor-voltage' || answer.kind === 'resistor-power') {
    const voltage = { kind: 'mesh-branch-voltage', componentId: id, unit: 'V', value: branch.voltage,
      resistance: branch.resistance, current: branch.current, expression: `Voltage drop across ${id}: ${branch.voltage} V.` };
    if (answer.kind === 'resistor-voltage') return {
      ...target, title: `Find the voltage across ${id}`,
      explanation: 'Find the signed branch current and multiply it by the resistance to get the voltage drop.',
      workedEquations: [current, voltage], finalAnswer: [voltage],
    };
    const power = { kind: 'resistor-power', id, unit: 'W', value: answer.value,
      branchVoltage: branch.voltage, branchCurrent: branch.current, expression: `Power dissipated by ${id}: ${answer.value} W.` };
    return {
      ...target, title: `Find the power dissipated by ${id}`,
      explanation: 'Use the branch current to find the voltage drop. Multiply that drop by the signed current to find the power.',
      workedEquations: [current, voltage, power], finalAnswer: [power],
    };
  }
  if (answer.kind === 'source-supply' && branch.sourceVoltage != null) {
    const supplied = { kind: 'source-supply', id, unit: 'A', value: answer.value, branchCurrent: branch.current,
      expression: `Current supplied by ${id}: ${answer.value} A.` };
    return {
      ...target, title: `Find the current supplied by ${id}`,
      explanation: 'The branch reference points into the positive terminal. Current supplied by the source uses the opposite direction.',
      workedEquations: [current, supplied], finalAnswer: [supplied],
    };
  }
  return target;
}

// Build teaching steps from the mesh solver's equations and oriented boundaries.
export function buildDcMeshLesson(result, intent = { kind: 'general' }) {
  if (!result?.ok || result.method !== 'mesh-current-analysis' || intent.kind === 'unsupported') return null;
  const answer = answerDcQuestion(intent.kind ? intent : { kind: 'general' }, result);
  const { meshes, branches } = result;
  const meshById = new Map(meshes.map((mesh) => [mesh.id, mesh]));
  const branchById = new Map(branches.map((branch) => [branch.componentId, branch]));
  const steps = [];
  const add = (id, title, explanation, metadata = {}) => steps.push({ id, title, explanation, equations: [], ...metadata });
  const region = (ids) => ({ meshRegion: ids.map((id) => meshById.get(id)) });
  const references = (focused, mentioned = []) => ({
    meshCurrentReferences: [...new Set([...focused, ...mentioned])].map((id) => ({
      mesh: meshById.get(id), emphasized: focused.includes(id),
    })),
  });
  const hasSupermesh = result.equations.some(({ kind }) => kind === 'supermesh-kvl');

  // With one loop, its first equation can also introduce the direction.
  if (meshes.length > 1) {
    for (const { id } of meshes) add(`reference-${id}`, `Choose a direction for ${id}`,
      'Use the loop direction as positive. A negative answer means current goes the other way.', {
        ...region([id]), ...references([id]), showMeshDirection: true,
        equations: [{ kind: 'mesh-reference', meshId: id, expression: `Reference current for ${id}.` }],
      });
  }
  if (intent.kind === 'supermesh' && !hasSupermesh) {
    add('supermesh-overview', 'Is a supermesh needed?',
      'A shared current source can require a combined loop. This circuit has no independent combined-loop voltage equation.');
  }

  const rows = [];
  for (const [index, equation] of result.equations.entries()) {
    const { kind, meshIds, componentId, coefficients, rhs, independent } = equation;
    const constraint = kind === 'current-constraint';
    const row = { kind: 'mesh-row', index: rows.length + 1, unit: constraint ? 'A' : 'V', coefficients, rhs,
      terms: meshes.flatMap(({ id }, column) => coefficients[column] ? [{ meshId: id, coefficient: coefficients[column] }] : []),
      expression: `Collect terms for equation ${rows.length + 1}.` };
    if (independent) rows.push(row);
    if (constraint) {
      const terms = row.terms.map(({ meshId, coefficient: sign }) => ({ meshId, sign }));
      const lessonEquation = { kind: 'mesh-current-constraint', componentId, terms, rhs,
        expression: `The signed mesh currents through ${componentId} add to ${rhs} A.` };
      const explanation = terms.length > 1
        ? 'The loops cross the source in opposite directions. Subtract their currents in the order set by the source arrow.'
        : terms.length === 1
          ? 'The source fixes the current in this loop. Use the source arrow to choose the sign.'
          : 'No mesh current goes through this branch, so its specified current must be zero.';
      const introduce = meshes.length === 1 && terms.length === 1;
      add(`constraint-${index}`, introduce ? `Choose a direction for ${meshes[0].id} and apply the source`
        : independent ? `Use the current set by ${componentId}` : `Check the current set by ${componentId}`,
      `${introduce ? 'Pick the loop direction as positive. ' : ''}${explanation}`, {
        ...(terms.length === 1 ? region([terms[0].meshId]) : { componentIds: [componentId] }),
        ...references(terms.map(({ meshId }) => meshId)),
        showMeshDirection: introduce,
        workedEquations: [lessonEquation],
        ...(independent ? { finalAnswer: [row] } : {}),
      });
      continue;
    }
    const supermesh = kind === 'supermesh-kvl';
    const terms = equation.branchTerms.map((term) => term.kind === 'voltage' ? term : ({
      ...term, sign: 1, incidence: branchById.get(term.componentId).meshIncidence
        .map(({ meshId, sign }) => ({ meshId, sign: sign * term.sign })).sort((a, b) => b.sign - a.sign),
    }));
    const name = meshIds.join(' + ');
    const introduce = meshes.length === 1;
    const explanation = supermesh
      ? 'Add the voltage drops around the combined boundary. The shared current source is inside, so its unknown drop cancels.'
      : terms.some((term) => term.incidence?.length > 1)
        ? 'The signed voltage drops add to zero. Use the difference of the loop currents at a shared resistor.'
        : 'Kirchhoff’s voltage law says the signed drops around a loop add to zero.';
    const setup = introduce ? 'Pick the loop direction as positive. ' : '';
    add(`kvl-${index}`, supermesh ? `Write supermesh KVL for ${name}`
      : introduce ? `Choose a direction for ${name} and write KVL` : `Write KVL for ${name}`, setup + explanation, {
      ...region(meshIds),
      ...references(meshIds, terms.flatMap((term) => term.incidence?.map(({ meshId }) => meshId) ?? [])),
      showMeshDirection: introduce,
      workedEquations: [{ kind: 'mesh-kvl', terms, expression: `Signed voltage drops around ${name} sum to 0 V.` }],
      showSourcePolarity: terms.some((term) => term.kind === 'voltage'),
      finalAnswer: [row],
    });
  }

  const algebra = traceMeshAlgebra(rows, meshes);
  for (const { meshId, changes } of algebra?.elimination ?? []) {
    add(`eliminate-${meshId}`, `Eliminate the current for ${meshId}`,
      'Multiply one equation and subtract it from another to cancel this current.', {
        ...references([meshId], changes.flatMap(({ terms }) => terms.map((term) => term.meshId))),
        equations: changes,
      });
  }

  const scale = branches.reduce((max, branch) => Math.max(max, Math.abs(branch.current)), 0);
  const actualFlow = {
    currentArrowMode: 'actual', branchFlows: branches,
    currentDirections: branches.map(({ componentId, fromTerminal, toTerminal, fromNodeId, toNodeId, current, sourceCurrent }) => ({
      componentId, branchId: componentId, fromTerminal, toTerminal, fromNodeId, toNodeId, signedCurrent: current,
      effectivelyZero: sourceCurrent != null ? sourceCurrent === 0 : Math.abs(current) <= 64 * Number.EPSILON * scale,
    })),
  };
  if (meshes.length) {
    add('mesh-solution', meshes.length === 1 ? 'Find the loop current' : 'Solve for the mesh currents',
      algebra ? meshes.length === 1 ? 'Divide by the current’s coefficient. A negative result goes against the loop direction.'
        : 'Start with an equation with one unknown. Use each answer to find the next current.'
        : 'The original verified equations give these currents. A simplified algebra trace could not be verified.', {
      ...actualFlow, workedEquations: algebra?.isolation ?? steps.flatMap((step) => step.workedEquations ?? []),
      finalAnswer: algebra?.isolation ?? meshes.map(({ id, current }) => ({ kind: 'mesh-current-value', meshId: id,
        value: current, unit: 'A', expression: `Mesh ${id} current: ${current} A.` })),
    });
  }

  const branchCurrents = branches.map((branch) => ({
    kind: 'mesh-branch-current', componentId: branch.componentId, value: branch.current, unit: 'A',
    terms: branch.meshIncidence.map((term) => ({ ...term, current: meshById.get(term.meshId).current })),
    expression: `Current through ${branch.componentId}: ${branch.current} A from ${branch.fromTerminal} to ${branch.toTerminal}.`,
  }));
  const nodeEntries = nodeVoltageEntries(result);
  const target = requestedCalculation(answer, result, branchCurrents, nodeEntries);
  if (answer.kind === 'mesh-currents' && meshes.length) {
    // The solve step already gives the requested answer.
    Object.assign(steps.at(-1), { allResults: [...branchCurrents, ...nodeEntries], extraEquations: branchCurrents });
  } else {
    const explanation = meshes.length
      ? 'Add the signed loop currents through each branch. A positive result follows the branch’s reference direction.'
      : 'There are no bounded loops. A branch with no mesh current has zero current.';
    add('mesh-branch-results', target?.title ?? 'Find the branch currents', target?.explanation ?? explanation, {
      ...actualFlow, workedEquations: branchCurrents, finalAnswer: branchCurrents,
      componentIds: branches.map(({ componentId }) => componentId), nodeIds: result.nodes.map(({ id }) => id),
      ...target, allResults: target ? [...branchCurrents, ...nodeEntries].filter((entry) => !target.finalAnswer.includes(entry)) : nodeEntries,
      extraEquations: target ? branchCurrents.filter((entry) => !target.workedEquations.includes(entry)) : [],
    });
  }
  steps.at(-1).directionEquations = branches.map(({ componentId, fromNodeId, toNodeId, fromTerminal, toTerminal }) => ({
    kind: 'current-direction', branchId: componentId, fromNodeId, toNodeId, fromTerminal, toTerminal,
    expression: `${componentId}: ${fromTerminal} to ${toTerminal}.`,
  }));
  return { ok: true, method: 'mesh-current-analysis', steps };
}
