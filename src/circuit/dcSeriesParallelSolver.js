import { prepareDcNetwork, solveDcCircuit } from './dcSolver.js';
import { termKey } from './electricalGraph.js';

const compareIds = (a, b) => a < b ? -1 : Number(a > b);
const endpoints = ({ from, to }) => [from.node, to.node];
const issue = (code, message, details = {}) => ({ code, message, ...details });
const invalid = (issues, progress = {}) => ({ ok: false, status: 'invalid', ...progress, issues });
const ordered = (entries) => [...entries].sort((a, b) => compareIds(a.id, b.id));

function incidentBranches(branches) {
  const incident = new Map();
  for (const branch of branches) {
    // A self-loop has two incidences at its one node.
    for (const id of endpoints(branch)) {
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push(branch);
    }
  }
  return incident;
}

function disconnectedNodes(nodeIds, incident) {
  const first = nodeIds.values().next().value;
  const visited = new Set([first]);
  const pending = [first];
  for (let index = 0; index < pending.length; index += 1) {
    for (const branch of incident.get(pending[index])) {
      for (const id of endpoints(branch)) {
        if (visited.has(id)) continue;
        visited.add(id);
        pending.push(id);
      }
    }
  }
  return [...nodeIds].filter((id) => !visited.has(id)).sort();
}

function describeBranch(branch) {
  return {
    id: branch.id, type: branch.type,
    fromNodeId: branch.from.node, toNodeId: branch.to.node,
    fromTerminal: branch.from.label, toTerminal: branch.to.label,
    ...(branch.kind === 'resistance' ? { resistance: branch.value, originalComponentIds: branch.tree.originalComponentIds }
      : branch.kind === 'voltage' ? { sourceVoltage: branch.value } : { sourceCurrent: branch.value }),
  };
}

function snapshot(branches) {
  const nodes = new Map();
  for (const branch of branches) {
    for (const { label, node } of [branch.from, branch.to]) {
      if (!nodes.has(node)) nodes.set(node, []);
      nodes.get(node).push(termKey(branch.id, label));
    }
  }
  return {
    nodes: [...nodes.keys()].sort().map((id) => ({ id, members: nodes.get(id).sort() })),
    branches: branches.map(describeBranch),
  };
}

function nextGroup(branches) {
  const parallel = new Map();
  for (const branch of branches) {
    const [a, b] = endpoints(branch).sort();
    if (branch.kind !== 'resistance' || a === b) continue;
    const key = JSON.stringify([a, b]);
    if (!parallel.has(key)) parallel.set(key, { operation: 'parallel', a, b, members: [] });
    parallel.get(key).members.push({ branch, sign: branch.from.node === a ? 1 : -1 });
  }
  for (const group of parallel.values()) if (group.members.length > 1) return group;

  const incident = incidentBranches(branches);
  for (const sharedNodeId of [...incident.keys()].sort()) {
    const pair = incident.get(sharedNodeId);
    if (pair.length !== 2 || pair[0] === pair[1] || pair.some(({ kind }) => kind !== 'resistance')) continue;
    const otherEnd = (branch) => branch.from.node === sharedNodeId ? branch.to.node : branch.from.node;
    const [first, last] = [...pair].sort((a, b) => compareIds(otherEnd(a), otherEnd(b)));
    const a = otherEnd(first);
    const b = otherEnd(last);
    if (a === b) continue;
    return {
      operation: 'series', a, b, sharedNodeId,
      members: [
        { branch: first, sign: first.from.node === a ? 1 : -1 },
        { branch: last, sign: last.to.node === b ? 1 : -1 },
      ],
    };
  }
  return null;
}

function equivalentResistance(group) {
  if (group.operation === 'series') return group.members.reduce((sum, { branch }) => sum + branch.value, 0);
  // Scale the reciprocal sum by the smallest resistance so the sum stays
  // finite even when adding the unscaled conductances would overflow.
  const smallest = group.members.reduce((min, { branch }) => Math.min(min, branch.value), Infinity);
  return smallest / group.members.reduce((sum, { branch }) => sum + smallest / branch.value, 0);
}

function reconstruct(root, source) {
  const loadCurrent = source.value / root.resistance;
  const sign = root.fromNodeId === source.from.node ? 1 : -1;
  const pending = [{ tree: root, voltage: sign * source.value, current: sign * loadCurrent }];
  const branchResults = [];
  const backSubstitution = [];
  for (let i = 0; i < pending.length; i += 1) {
    const { tree, voltage, current } = pending[i];
    const power = voltage * current;
    if (![voltage, current, power].every(Number.isFinite)) return null;
    if (tree.operation === 'resistor') {
      branchResults.push({
        componentId: tree.id, fromNodeId: tree.fromNodeId, toNodeId: tree.toNodeId,
        fromTerminal: tree.fromTerminal, toTerminal: tree.toTerminal, resistance: tree.resistance,
        voltage, current, power,
      });
      continue;
    }
    const members = tree.members.map(({ tree: member, sign: orientation }) => {
      if (tree.operation === 'series') {
        const memberCurrent = current * orientation;
        return { tree: member, voltage: memberCurrent * member.resistance, current: memberCurrent };
      }
      const memberVoltage = voltage * orientation;
      return { tree: member, voltage: memberVoltage, current: memberVoltage / member.resistance };
    });
    pending.push(...members);
    backSubstitution.push({
      id: tree.id, operation: tree.operation, voltage, current,
      members: members.map(({ tree: member, voltage: drop, current: amps }) =>
        ({ id: member.id, voltage: drop, current: amps })),
    });
  }
  const { id, ...sourceBranch } = describeBranch(source);
  const sourceResult = {
    ...sourceBranch, componentId: id, voltage: source.value, current: -loadCurrent,
    power: -source.value * loadCurrent,
  };
  return Number.isFinite(sourceResult.power)
    ? { source: sourceResult, branches: branchResults.sort((a, b) => compareIds(a.componentId, b.componentId)),
      backSubstitution } : null;
}

function verify(graph, result) {
  const oracle = solveDcCircuit({
    ...graph, nodes: ordered(graph.nodes), components: ordered(graph.components),
  }, { referenceNodeId: result.source.toNodeId });
  if (!oracle.ok) return oracle;
  const actual = new Map([...result.branches, result.source].map((branch) => [branch.componentId, branch]));
  const errors = { voltage: 0, current: 0, power: 0 };
  const scales = { voltage: 0, current: 0, power: 0 };
  for (const { voltage, current } of oracle.branches) {
    scales.voltage = Math.max(scales.voltage, Math.abs(voltage));
    scales.current = Math.max(scales.current, Math.abs(current));
    scales.power = Math.max(scales.power, Math.abs(voltage * current));
  }
  const roundoff = 64 * Number.EPSILON * actual.size;
  for (const { componentId, voltage, current } of oracle.branches) {
    const expected = { voltage, current, power: voltage * current };
    for (const field of ['voltage', 'current', 'power']) {
      const computed = actual.get(componentId)[field];
      const error = Math.abs(computed - expected[field]);
      const limit = 1e-9 * Math.max(Math.abs(computed), Math.abs(expected[field])) + roundoff * scales[field];
      if (!Number.isFinite(error) || error > limit) {
        return { ok: false, issues: [issue('verification-mismatch', 'Series-parallel reduction and MNA disagree.',
          { componentId, quantity: field })] };
      }
      errors[field] = Math.max(errors[field], error);
    }
  }
  return { ok: true, maxVoltageError: errors.voltage, maxCurrentError: errors.current, maxPowerError: errors.power };
}

/**
 * Reduce a verified DC graph. All values are in SI units.
 * Each member's sign relates its own orientation to its parent equivalent.
 * Complete results include signed passive branch quantities. A partial result
 * carries the reduction forest and remaining topology for further analysis.
 */
export function solveDcSeriesParallel(graph) {
  const network = prepareDcNetwork(graph);
  if (!network.ok) {
    return network.issues.every(({ code }) => code === 'unsupported-component')
      ? { ok: false, status: 'unsupported', issues: network.issues } : invalid(network.issues);
  }
  const { nodeIds } = network;
  let branches = ordered(network.branches).map((branch) => branch.kind === 'resistance' ? {
    ...branch, tree: {
      id: branch.id, operation: 'resistor', resistance: branch.value, originalComponentIds: [branch.id],
      fromNodeId: branch.from.node, toNodeId: branch.to.node,
      fromTerminal: branch.from.label, toTerminal: branch.to.label,
    },
  } : branch);
  const initialGraph = snapshot(branches);
  const steps = [];
  const progress = () => ({
    initialGraph, steps, remainingGraph: steps.at(-1)?.topology ?? initialGraph,
    reductionTree: { roots: branches.flatMap((branch) => branch.tree ? [branch.tree] : []) },
  });
  const disconnected = disconnectedNodes(nodeIds, incidentBranches(branches));
  if (disconnected.length) {
    return invalid([issue('disconnected-network', 'The graph has a disconnected or floating subnetwork.',
      { nodeIds: disconnected })], progress());
  }
  const shorted = branches.find((branch) => branch.kind === 'voltage' && branch.from.node === branch.to.node);
  if (shorted) {
    return invalid([issue('shorted-voltage-source', 'The voltage source terminals share a node, so a unique source current cannot be determined.',
      { componentId: shorted.id })], progress());
  }

  const usedIds = new Set(branches.map(({ id }) => id));
  let sequence = 1;
  for (let group = nextGroup(branches); group; group = nextGroup(branches)) {
    const { a, b, operation, members, sharedNodeId } = group;
    const resistance = equivalentResistance(group);
    if (!Number.isFinite(resistance) || resistance <= 0) {
      return invalid([issue('numerical-failure', 'An equivalent resistance is outside the finite positive range.',
        { componentIds: members.map(({ branch }) => branch.id) })], progress());
    }
    let id;
    do { id = `equivalent-${sequence++}`; } while (usedIds.has(id));
    usedIds.add(id);
    const memberIds = new Set(members.map(({ branch }) => branch.id));
    const originalComponentIds = members.flatMap(({ branch }) => branch.tree.originalComponentIds).sort();
    const tree = {
      id, operation, resistance, originalComponentIds, fromNodeId: a, toNodeId: b,
      members: members.map(({ branch, sign }) => ({ sign, tree: branch.tree })),
    };
    const equivalent = {
      id, type: 'resistor', kind: 'resistance', value: resistance, tree,
      from: { node: a, label: 'A' }, to: { node: b, label: 'B' },
    };
    branches = ordered([...branches.filter((branch) => !memberIds.has(branch.id)), equivalent]);
    steps.push({
      id, operation, equivalentResistance: resistance, fromNodeId: a, toNodeId: b, originalComponentIds,
      ...(sharedNodeId ? { sharedNodeId } : {}),
      members: members.map(({ branch, sign }) => ({ ...describeBranch(branch), sign })),
      topology: snapshot(branches),
    });
  }

  const sources = branches.filter(({ kind }) => kind !== 'resistance');
  const resistors = branches.filter(({ kind }) => kind === 'resistance');
  const [source] = sources;
  const [load] = resistors;
  const singleVoltageSource = sources.length === 1 && source.kind === 'voltage';
  const reducedToLoad = singleVoltageSource && resistors.length === 1 &&
    load.from.node !== load.to.node && endpoints(source).every((id) => endpoints(load).includes(id));
  if (!reducedToLoad) {
    const reason = !singleVoltageSource ? issue('source-configuration', 'A total equivalent requires exactly one independent voltage source and no current sources.')
      : issue('network-not-reducible', 'Series and parallel combinations do not reduce the remaining network to one load across the source.');
    return { ok: steps.length > 0, status: steps.length ? 'partial' : 'unsupported', ...progress(), issues: [reason] };
  }

  const result = reconstruct(load.tree, source);
  if (!result) return invalid([issue('numerical-failure', 'The branch results exceed floating-point limits.')], progress());
  const verification = verify(graph, result);
  if (!verification.ok) return invalid(verification.issues, progress());
  return { ok: true, status: 'complete', ...progress(), equivalentResistance: load.value, ...result, verification };
}
