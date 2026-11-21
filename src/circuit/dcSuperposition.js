import { prepareDcNetwork, solveDcCircuit } from './dcSolver.js';

const ordered = (entries) => [...entries].sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id));
const issue = (code, message, details = {}) => ({ code, message, ...details });
const maxMagnitude = (a, b) => Math.max(Math.abs(a), Math.abs(b));

// Keep cancellation errors small when several sources drive a branch in
// opposing directions. Retain the term scale for the verification tolerances.
function sumContributions(results, index, key) {
  let sum = 0;
  let correction = 0;
  let scale = 0;
  for (const result of results) {
    const value = result[index][key];
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
    scale = maxMagnitude(scale, value);
  }
  return { value: sum + correction, scale };
}

function combineAndVerify(originalBranches, direct, contributions) {
  const nodeCases = contributions.map(({ nodes }) => nodes);
  const branchCases = contributions.map(({ branches }) => branches);
  const roundoff = 64 * Number.EPSILON * Math.max(1, contributions.length, direct.nodes.length + direct.branches.length);
  const nodeSums = direct.nodes.map(({ id }, index) => ({ id, ...sumContributions(nodeCases, index, 'voltage') }));
  const networkVoltageScale = nodeSums.reduce((scale, node) => Math.max(scale, node.scale), 0);
  const byNode = new Map(nodeSums.map((node) => [node.id, node]));
  const kcl = new Map(nodeSums.map(({ id }) => [id, { sum: 0, scale: 0, rounding: 0 }]));
  const metrics = {
    maxNodeVoltageError: 0, maxBranchVoltageError: 0, maxBranchCurrentError: 0,
    maxKclResidual: 0, maxKvlResidual: 0, maxVoltageConstraintResidual: 0, maxCurrentLawResidual: 0,
  };
  const issues = [];

  function compare(metric, actual, expected, rounding, details) {
    const error = Math.abs(actual - expected);
    const tolerance = 1e-9 * maxMagnitude(actual, expected) + rounding;
    metrics[metric] = Math.max(metrics[metric], error);
    if (!Number.isFinite(error) || !Number.isFinite(tolerance) || error > tolerance) {
      issues.push(issue('verification-mismatch', `${details.quantity} failed superposition verification.`,
        { ...details, actual, expected, tolerance }));
    }
  }

  for (const [index, { id, value, scale }] of nodeSums.entries()) {
    compare('maxNodeVoltageError', value, direct.nodes[index].voltage, roundoff * scale,
      { nodeId: id, quantity: 'Node voltage' });
  }
  const branches = direct.branches.map((branch, index) => {
    const { componentId, fromNodeId, toNodeId } = branch;
    const { kind, value: originalValue } = originalBranches[index];
    const from = byNode.get(fromNodeId);
    const to = byNode.get(toNodeId);
    const volts = sumContributions(branchCases, index, 'voltage');
    const amps = sumContributions(branchCases, index, 'current');
    const terminalRoundoff = roundoff * Math.max(from.scale, to.scale, volts.scale);
    const resistorRoundoff = kind === 'resistance' && from !== to ? terminalRoundoff / originalValue : 0;
    const currentRoundoff = roundoff * amps.scale + resistorRoundoff;

    compare('maxBranchVoltageError', volts.value, branch.voltage, terminalRoundoff,
      { componentId, quantity: 'Branch voltage' });
    compare('maxBranchCurrentError', amps.value, branch.current, currentRoundoff,
      { componentId, quantity: 'Branch current' });
    // Agreement between every branch drop and a shared set of node
    // potentials verifies KVL on every closed electrical path.
    compare('maxKvlResidual', volts.value, from.value - to.value, terminalRoundoff,
      { componentId, quantity: 'KVL branch drop' });

    if (kind === 'voltage') {
      const constraintRoundoff = originalValue === 0 ? roundoff * networkVoltageScale : terminalRoundoff;
      compare('maxVoltageConstraintResidual', volts.value, originalValue, constraintRoundoff,
        { componentId, quantity: 'Ideal voltage-source constraint' });
    } else {
      compare('maxCurrentLawResidual', amps.value, kind === 'current' ? originalValue : volts.value / originalValue,
        currentRoundoff, { componentId, quantity: kind === 'current' ? 'Ideal current-source constraint' : 'Ohm’s law' });
    }

    if (from !== to) {
      for (const [id, sign] of [[fromNodeId, 1], [toNodeId, -1]]) {
        const balance = kcl.get(id);
        balance.sum += sign * amps.value;
        balance.scale = maxMagnitude(balance.scale, amps.value);
        balance.rounding += currentRoundoff;
      }
    }

    const power = kind === 'resistance' ? volts.value * amps.value : null;
    if (power !== null && !Number.isFinite(power)) {
      issues.push(issue('power-out-of-range', 'The combined resistor power exceeds floating-point limits.', { componentId }));
    }
    const { voltageResidual, ...orientation } = branch;
    return { ...orientation, voltage: volts.value, current: amps.value, ...(power !== null ? { power } : {}) };
  });

  const nodes = nodeSums.map(({ id, value }) => {
    const { sum, scale, rounding } = kcl.get(id);
    // KCL compares a sum to zero; scale the relative tolerance with the
    // individual currents rather than with the residual being tested.
    compare('maxKclResidual', sum, 0, 1e-9 * scale + rounding, { nodeId: id, quantity: 'KCL current balance' });
    return { id, voltage: value, kclResidual: sum };
  });

  const verification = { status: issues.length ? 'failed' : 'verified', ...metrics };
  return issues.length ? { issues, verification } : { combined: { nodes, branches }, verification };
}

/**
 * Solve each independent source against the same MNA topology and reference.
 * Currents are positive from fromTerminal to toTerminal and voltages are
 * V(fromNodeId) − V(toNodeId). Quantities are in V, A, Ω and W.
 */
export function solveDcSuperposition(graph, { referenceNodeId } = {}) {
  const method = 'superposition';
  const validated = prepareDcNetwork(graph);
  if (!validated.ok) return { ...validated, method,
    status: validated.issues.every(({ code }) => code === 'unsupported-component') ? 'unsupported' : 'invalid' };

  const orderedGraph = { ...graph, nodes: ordered(graph.nodes), components: ordered(graph.components) };
  const originalBranches = ordered(validated.branches);
  const sources = originalBranches.filter(({ kind }) => kind !== 'resistance').map(({ id, type, kind, value, from, to }) => ({
    componentId: id, type, kind, value, unit: kind === 'voltage' ? 'V' : 'A',
    fromNodeId: from.node, toNodeId: to.node, fromTerminal: from.label, toTerminal: to.label,
  }));
  const chosenReference = referenceNodeId ?? graph.referenceNodeId ?? sources.find(({ kind }) => kind === 'voltage')?.toNodeId ?? orderedGraph.nodes[0].id;
  if (!validated.nodeIds.has(chosenReference)) return { ok: false, method, status: 'invalid', sources,
    issues: [issue('invalid-reference', `Reference node ${chosenReference} is not in the electrical graph.`, { nodeId: chosenReference })] };

  const options = { referenceNodeId: chosenReference };
  const directResult = solveDcCircuit(orderedGraph, options);
  const contributions = sources.map(({ componentId: activeSourceId }) => {
    // A zero-voltage source keeps its short's measurable branch current. A
    // zero-current source stamps no injection or conductance, like an open.
    const deactivatedSources = sources.filter(({ componentId }) => componentId !== activeSourceId)
      .map(({ componentId, kind, unit }) => ({ componentId, replacement: kind === 'voltage' ? 'short' : 'open', value: 0, unit }));
    const zeroed = new Map(deactivatedSources.map(({ componentId, unit }) => [componentId, `0 ${unit}`]));
    const solved = solveDcCircuit({ ...orderedGraph, components: orderedGraph.components.map((component) =>
      zeroed.has(component.id) ? { ...component, valueRaw: zeroed.get(component.id) } : component) }, options);
    return { activeSourceId, deactivatedSources, ...solved };
  });

  const trace = { method, referenceNodeId: chosenReference, sources, contributions, directResult };
  const issues = [];
  if (!directResult.ok) issues.push(issue('original-solve-failed', 'The original circuit has no verified MNA solution.', { issues: directResult.issues }));
  for (const contribution of contributions.filter(({ ok }) => !ok)) {
    issues.push(issue('contribution-solve-failed', `Could not find a unique contribution from ${contribution.activeSourceId}.`,
      { activeSourceId: contribution.activeSourceId, issues: contribution.issues }));
  }
  if (issues.length) return { ok: false, status: 'invalid', ...trace, issues, verification: { status: 'not-run' } };

  const verified = combineAndVerify(originalBranches, directResult, contributions);
  const ok = verified.verification.status === 'verified';
  return { ok, status: ok ? 'complete' : 'invalid', ...trace, ...verified };
}
