import { polarityOf, termKey } from './electricalGraph.js';
import { parseDcValue } from './electricalValue.js';

const DC_SOURCES = new Set(['battery', 'voltage_source']);
const UNRESOLVED_DIAGNOSTICS = new Set([
  'conflicting-evidence', 'conflicting-terminal-assignment', 'declared-node-conflict',
  'junction-conflicts-with-evidence', 'junction-members-split', 'wire-trace-node-disagreement',
  'junction-member-not-a-terminal', 'node-group-member-not-a-terminal',
  'unknown-wire-endpoint', 'dropped-connection',
]);

function issue(code, message, context = {}) {
  return { code, message, ...context };
}

function failure(...issues) {
  return { ok: false, issues };
}

function readValue(component, isSource) {
  const { status, value } = parseDcValue(component);
  const context = { componentId: component.id };
  if (status === 'missing-value') {
    return { problem: issue('missing-value', `Component ${component.id} has no reported value.`, context) };
  }

  if (status !== 'ok') {
    const detail = status === 'missing-unit' ? 'The unit is missing. '
      : status === 'invalid-unit' ? 'The unit contains unreadable or unexpected characters. ' : '';
    return {
      problem: issue(
        isSource ? 'invalid-voltage' : 'invalid-resistance',
        `${component.id} requires ${isSource ? 'a finite voltage in volts' : 'a finite, positive resistance in ohms'}. ${detail}Check the printed value and enter it under Edit component values.`,
        context,
      ),
    };
  }
  return { value };
}

function validateNetwork(graph) {
  const issues = [];
  const nodeIds = new Set();
  const nodeOf = new Map();
  for (const node of graph.nodes) {
    const id = node?.id;
    if (typeof id !== 'string' || !id || nodeIds.has(id) || !Array.isArray(node.members)) {
      issues.push(issue('invalid-node', 'Each electrical node needs a unique ID and a terminal membership list.', { nodeId: id }));
      continue;
    }
    nodeIds.add(id);
    if (node.members.length === 0) {
      issues.push(issue('floating-node', `Node ${id} has no terminals.`, { nodeId: id }));
    } else if (node.members.length === 1) {
      issues.push(issue('open-terminal', `Node ${id} has only terminal ${node.members[0]}.`, { nodeId: id }));
    }
    for (const key of node.members) {
      if (typeof key !== 'string' || !key || nodeOf.has(key)) {
        issues.push(issue('invalid-membership', `Invalid or repeated terminal membership at node ${id}.`, { nodeId: id, terminal: key }));
      } else {
        nodeOf.set(key, id);
      }
    }
  }

  const branches = [];
  const componentIds = new Set();
  const usedTerminals = new Set();
  for (const component of graph.components) {
    const id = component?.id;
    if (typeof id !== 'string' || !id || componentIds.has(id)) {
      issues.push(issue('invalid-component', 'Each component needs a unique ID.', { componentId: id }));
      continue;
    }
    componentIds.add(id);
    const terminals = component.terminals;
    if (!Array.isArray(terminals) || terminals.length !== 2) {
      issues.push(issue('invalid-terminals', `Component ${id} must declare two terminals.`, { componentId: id }));
      continue;
    }
    let validTerminals = true;
    for (const terminal of terminals) {
      const key = termKey(id, terminal?.label);
      if (!key || !nodeIds.has(terminal.node) || nodeOf.get(key) !== terminal.node || usedTerminals.has(key)) {
        issues.push(issue('invalid-membership', `Terminal ${key ?? id} has no unique, matching node assignment.`,
          { componentId: id, terminal: key, nodeId: terminal?.node }));
        validTerminals = false;
      }
      if (key) usedTerminals.add(key);
    }
    const isSource = DC_SOURCES.has(component.type);
    if (!isSource && component.type !== 'resistor') {
      issues.push(issue('unsupported-component', `Component ${id} has unsupported type ${component.type}.`, { componentId: id }));
      continue;
    }
    if (!validTerminals) continue;

    let [from, to] = terminals;
    if (isSource) {
      if (polarityOf(to.label) === '+') [from, to] = [to, from];
      if (polarityOf(from.label) !== '+' || polarityOf(to.label) !== '-') {
        issues.push(issue('unknown-polarity', `Voltage source ${id} needs distinct positive and negative terminal labels.`,
          { componentId: id }));
        continue;
      }
    }
    const { value, problem } = readValue(component, isSource);
    if (problem) {
      issues.push(problem);
      continue;
    }
    branches.push({ id, type: component.type, isSource, from, to, value });
  }
  for (const [terminal, nodeId] of nodeOf) {
    if (!usedTerminals.has(terminal)) {
      issues.push(issue('invalid-membership', `Node ${nodeId} names unknown terminal ${terminal}.`, { nodeId, terminal }));
    }
  }
  return { issues, nodeIds, branches };
}

function unreachableNodes(nodeIds, branches, reference) {
  const neighbors = new Map([...nodeIds].map((id) => [id, []]));
  for (const { from, to } of branches) {
    neighbors.get(from.node).push(to.node);
    neighbors.get(to.node).push(from.node);
  }
  const visited = new Set([reference]);
  const queue = [reference];
  for (let i = 0; i < queue.length; i += 1) {
    for (const neighbor of neighbors.get(queue[i])) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return [...nodeIds].filter((id) => !visited.has(id));
}

function stampNetwork(nodeIds, branches, sources, reference) {
  const index = new Map([...nodeIds].filter((id) => id !== reference).map((id, i) => [id, i]));
  const size = index.size + sources.length;
  const matrix = Array.from({ length: size }, () => new Float64Array(size + 1));
  for (const { isSource, from, to, value } of branches) {
    if (isSource || from.node === to.node) continue;
    const a = index.get(from.node);
    const b = index.get(to.node);
    const conductance = 1 / value;
    if (a !== undefined) matrix[a][a] += conductance;
    if (b !== undefined) matrix[b][b] += conductance;
    if (a !== undefined && b !== undefined) {
      matrix[a][b] -= conductance;
      matrix[b][a] -= conductance;
    }
  }
  for (const [i, source] of sources.entries()) {
    const k = index.size + i;
    const a = index.get(source.from.node);
    const b = index.get(source.to.node);
    if (a !== undefined) {
      matrix[a][k] += 1;
      matrix[k][a] += 1;
    }
    if (b !== undefined) {
      matrix[b][k] -= 1;
      matrix[k][b] -= 1;
    }
    matrix[k][size] = source.value;
  }
  return { matrix, index };
}

/** Equilibrated Gaussian elimination with deterministic partial pivoting. */
function solveMatrix(matrix) {
  const n = matrix.length;
  const tolerance = 16 * Number.EPSILON * Math.max(n, 1);
  const rhsMagnitude = [];
  for (const row of matrix) {
    let scale = 0;
    for (let j = 0; j < n; j += 1) scale = Math.max(scale, Math.abs(row[j]));
    if (!Number.isFinite(scale)) return { error: 'numerical-failure' };
    for (let j = 0; j <= n; j += 1) row[j] /= scale || 1;
    rhsMagnitude.push(Math.abs(row[n]));
  }

  const columnScale = new Float64Array(n);
  for (let j = 0; j < n; j += 1) {
    let scale = 0;
    for (const row of matrix) scale = Math.max(scale, Math.abs(row[j]));
    columnScale[j] = scale || 1;
    for (const row of matrix) row[j] /= columnScale[j];
  }

  let rank = 0;
  for (let col = 0; col < n; col += 1) {
    let pivot = rank;
    for (let i = rank + 1; i < n; i += 1) {
      if (Math.abs(matrix[i][col]) > Math.abs(matrix[pivot][col])) pivot = i;
    }
    if (Math.abs(matrix[pivot][col]) <= tolerance) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    [rhsMagnitude[rank], rhsMagnitude[pivot]] = [rhsMagnitude[pivot], rhsMagnitude[rank]];

    for (let i = rank + 1; i < n; i += 1) {
      const factor = matrix[i][col] / matrix[rank][col];
      matrix[i][col] = 0;
      for (let j = col + 1; j <= n; j += 1) matrix[i][j] -= factor * matrix[rank][j];
      rhsMagnitude[i] += Math.abs(factor) * rhsMagnitude[rank];
    }
    rank += 1;
  }

  if (!matrix.every((row) => row.every(Number.isFinite)) || !rhsMagnitude.every(Number.isFinite)) {
    return { error: 'numerical-failure' };
  }
  if (rank < n) {
    const inconsistent = matrix.slice(rank).some((row, i) =>
      Math.abs(row[n]) > tolerance * rhsMagnitude[rank + i]);
    return { error: inconsistent ? 'inconsistent-system' : 'singular-system' };
  }

  const solution = new Float64Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let rhs = matrix[i][n];
    for (let j = i + 1; j < n; j += 1) rhs -= matrix[i][j] * solution[j];
    solution[i] = rhs / matrix[i][i];
  }
  for (let i = 0; i < n; i += 1) solution[i] /= columnScale[i];
  return solution.every(Number.isFinite) ? { solution } : { error: 'numerical-failure' };
}

/**
 * Solve a complete electrical graph from buildGraph. Ignore all drawing data.
 *
 * Voltages are relative to referenceNodeId (default: the first DC source's
 * negative node, or the first graph node for a source-free network).
 * A branch reports V(fromNodeId) minus V(toNodeId). Current is positive when
 * it leaves the first node and enters the second through the component.
 * Resistors use terminal array order; sources use positive then negative.
 * All results use volts, amperes and ohms. Failed solves return only issues.
 */
export function solveDcCircuit(graph, { referenceNodeId } = {}) {
  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0 ||
      !Array.isArray(graph?.components) || graph.components.length === 0) {
    return failure(issue('invalid-graph', 'The solver needs an electrical graph with components and nodes.'));
  }
  const disputes = [...(graph.diagnostics ?? []), ...(graph.topology?.diagnostics ?? [])]
    .filter((diagnostic) => diagnostic.severity === 'error' || UNRESOLVED_DIAGNOSTICS.has(diagnostic.code));
  const { issues, nodeIds, branches } = validateNetwork(graph);
  if (graph.incomplete || graph.reconstruction_incomplete || graph.validation?.isValid === false ||
      graph.provisional?.length || graph.topology?.provisional?.length ||
      graph.topology?.edges?.some((edge) => edge.confirmed === false) || disputes.length) {
    return failure(issue('incomplete-connectivity', 'Resolve disputed or incomplete connectivity before solving.',
      { diagnostics: [...new Set([...disputes.map((entry) => entry.message), ...(graph.validation?.errors ?? [])])] }),
    ...issues);
  }

  if (issues.length) return failure(...issues);
  const sources = branches.filter((branch) => branch.isSource);
  const reference = referenceNodeId ?? sources[0]?.to.node ?? nodeIds.values().next().value;
  if (!nodeIds.has(reference)) {
    return failure(issue('invalid-reference', `Reference node ${reference} is not in the electrical graph.`, { nodeId: reference }));
  }
  const unreferenced = unreachableNodes(nodeIds, branches, reference);
  if (unreferenced.length) {
    return failure(issue('disconnected-network', 'Some nodes have no electrical path to the reference and have floating voltages.',
      { referenceNodeId: reference, nodeIds: unreferenced }));
  }

  const { matrix, index } = stampNetwork(nodeIds, branches, sources, reference);
  const { solution, error } = solveMatrix(matrix);
  if (error) {
    const messages = {
      'inconsistent-system': 'The source constraints are inconsistent. No solution satisfies all of them.',
      'singular-system': 'The circuit has no unique solution. Redundant ideal sources or numerical rank loss can cause this.',
      'numerical-failure': 'The circuit could not be solved within floating-point limits.',
    };
    return failure(issue(error, messages[error], { sourceIds: sources.map((source) => source.id) }));
  }

  const nodes = new Map([...nodeIds].map((id) => [id, {
    id,
    voltage: id === reference ? 0 : solution[index.get(id)],
    kclResidual: 0,
    currents: [],
  }]));
  const sourceIndex = new Map(sources.map((source, i) => [source.id, index.size + i]));
  const currentRoundoff = new Map([...nodeIds].map((id) => [id, 0]));
  const roundingFactor = 16 * Number.EPSILON * Math.max(matrix.length, 1);
  const results = [];
  let maxSourceVoltageResidual = 0;
  for (const { id, type, isSource, from, to, value } of branches) {
    const a = nodes.get(from.node);
    const b = nodes.get(to.node);
    const voltage = a.voltage - b.voltage;
    const current = isSource ? solution[sourceIndex.get(id)] : voltage / value;
    const residual = isSource ? voltage - value : 0;
    const voltageScale = Math.max(Math.abs(a.voltage), Math.abs(b.voltage));
    const voltageTolerance = value === 0 ? roundingFactor * voltageScale : 1e-9 * Math.abs(value);
    if (!Number.isFinite(voltage) || !Number.isFinite(current) ||
        (isSource && Math.abs(residual) > voltageTolerance)) {
      return failure(issue('numerical-failure', `The solution failed the branch equation for ${id}.`, { componentId: id }));
    }
    if (!isSource && a !== b) {
      // Near-equal node voltages can lose precision when subtracted. Bound
      // that cancellation error separately from the relative KCL tolerance.
      const errorBound = roundingFactor * voltageScale / value;
      currentRoundoff.set(a.id, currentRoundoff.get(a.id) + errorBound);
      currentRoundoff.set(b.id, currentRoundoff.get(b.id) + errorBound);
    }
    maxSourceVoltageResidual = Math.max(maxSourceVoltageResidual, Math.abs(residual));
    a.currents.push({ componentId: id, terminal: from.label, currentLeaving: current });
    b.currents.push({ componentId: id, terminal: to.label, currentLeaving: -current });
    results.push({
      componentId: id, type,
      fromNodeId: from.node, toNodeId: to.node,
      fromTerminal: from.label, toTerminal: to.label,
      voltage, current,
      ...(isSource ? { sourceVoltage: value, voltageResidual: residual } : { resistance: value }),
    });
  }

  let maxKclResidual = 0;
  for (const node of nodes.values()) {
    node.kclResidual = node.currents.reduce((sum, term) => sum + term.currentLeaving, 0);
    const scale = node.currents.reduce((max, term) => Math.max(max, Math.abs(term.currentLeaving)), 0);
    const tolerance = 1e-9 * scale + currentRoundoff.get(node.id);
    if (!Number.isFinite(node.kclResidual) || !Number.isFinite(tolerance) ||
        Math.abs(node.kclResidual) > tolerance) {
      return failure(issue('numerical-failure', `The solution failed current balance at node ${node.id}.`, { nodeId: node.id }));
    }
    maxKclResidual = Math.max(maxKclResidual, Math.abs(node.kclResidual));
  }
  return {
    ok: true,
    referenceNodeId: reference,
    nodes: [...nodes.values()],
    branches: results,
    residuals: { maxKclResidual, maxSourceVoltageResidual },
  };
}
