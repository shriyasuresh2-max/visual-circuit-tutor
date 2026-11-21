import { prepareDcNetwork, solveDcCircuit, solveMatrix } from './dcSolver.js';
import { embedCircuit } from './meshEmbedding.js';

const fail = (code, message, details = {}) => ({ ok: false, issues: [{ code, message, ...details }] });
const byId = (a, b) => a.id < b.id ? -1 : Number(a.id > b.id);

function indexFaces(faces, branches) {
  const faceOf = new Int32Array(2 * branches.length);
  faces.forEach((face, i) => face.forEach((dart) => { faceOf[dart] = i; }));
  const distinctBranches = (face) => new Set(face.map((dart) => dart >> 1)).size;
  const sizes = faces.map(distinctBranches);
  // Any face may be the outside face of a sphere embedding. Prefer the
  // largest boundary, with ties broken by the canonical first dart.
  let outside = 0;
  for (let i = 1; i < faces.length; i += 1) {
    if (sizes[i] > sizes[outside]) outside = i;
  }
  const faceMesh = faces.map(() => -1);
  const walk = (face) => face.map((dart) => {
    const { id, from, to } = branches[dart >> 1];
    return dart % 2 === 0
      ? { componentId: id, sign: 1, fromNodeId: from.node, toNodeId: to.node }
      : { componentId: id, sign: -1, fromNodeId: to.node, toNodeId: from.node };
  });
  const meshes = [];
  for (const [i, face] of faces.entries()) {
    if (i === outside) continue;
    faceMesh[i] = meshes.length;
    meshes.push({ id: `M${meshes.length + 1}`, orientation: 'clockwise', boundary: walk(face) });
  }
  const incidence = branches.map((_, i) => {
    const forward = faceMesh[faceOf[2 * i]];
    const reverse = faceMesh[faceOf[2 * i + 1]];
    if (forward === reverse) return [];
    return [{ index: forward, sign: 1 }, { index: reverse, sign: -1 }].filter(({ index }) => index >= 0);
  });
  return { meshes, incidence, externalBoundary: walk(faces[outside]), outside, faceOf };
}

function buildEquations(branches, faceCount, { meshes, incidence, outside, faceOf }) {
  const parent = Array.from({ length: faceCount }, (_, i) => i);
  const find = (face) => {
    while (parent[face] !== face) {
      parent[face] = parent[parent[face]];
      face = parent[face];
    }
    return face;
  };
  const equations = [];
  for (const [i, branch] of branches.entries()) {
    if (branch.kind !== 'current') continue;
    const a = find(faceOf[2 * i]);
    const b = find(faceOf[2 * i + 1]);
    const independent = a !== b;
    if (independent) parent[a] = b;
    const coefficients = meshes.map(() => 0);
    for (const { index, sign } of incidence[i]) coefficients[index] = sign;
    equations.push({
      kind: 'current-constraint', componentId: branch.id, coefficients, rhs: branch.value, independent,
    });
  }

  // Joining faces across every prescribed-current branch cancels all unknown
  // source drops. The cluster connected to the outside supplies no independent
  // KVL equation. A forest of the joining edges supplies the missing equations.
  const regions = new Map();
  let meshIndex = 0;
  for (let face = 0; face < faceCount; face += 1) {
    if (face === outside) continue;
    const region = find(face);
    if (region !== find(outside)) {
      if (!regions.has(region)) regions.set(region, []);
      regions.get(region).push(meshIndex);
    }
    meshIndex += 1;
  }
  for (const indexes of regions.values()) {
    const included = new Set(indexes);
    const coefficients = meshes.map(() => 0);
    const branchTerms = [];
    let rhs = 0;
    for (const [i, branch] of branches.entries()) {
      const sign = incidence[i].reduce((sum, member) => sum + (included.has(member.index) ? member.sign : 0), 0);
      if (!sign || branch.kind === 'current') continue;
      branchTerms.push({ componentId: branch.id, sign, kind: branch.kind, value: branch.value });
      if (branch.kind === 'voltage') rhs -= sign * branch.value;
      else for (const member of incidence[i]) coefficients[member.index] += sign * branch.value * member.sign;
    }
    equations.push({
      kind: indexes.length === 1 ? 'kvl' : 'supermesh-kvl',
      meshIds: indexes.map((index) => meshes[index].id),
      branchTerms, coefficients, rhs, independent: true,
    });
  }
  return equations;
}

function meshVoltages(nodeIds, branches, currents) {
  const adjacent = new Map(nodeIds.map((id) => [id, []]));
  for (const [i, branch] of branches.entries()) {
    if (branch.kind === 'current') continue;
    const drop = branch.kind === 'voltage' ? branch.value : branch.value * currents[i];
    adjacent.get(branch.from.node).push([branch.to.node, -drop]);
    adjacent.get(branch.to.node).push([branch.from.node, drop]);
  }
  const potentials = new Map([[nodeIds[0], 0]]);
  const queue = [nodeIds[0]];
  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    for (const [next, delta] of adjacent.get(node)) {
      if (potentials.has(next)) continue;
      potentials.set(next, potentials.get(node) + delta);
      queue.push(next);
    }
  }
  return potentials;
}

const embeddingMessages = {
  'disconnected-network': 'Mesh analysis requires one connected circuit.',
  nonplanar: 'The electrical graph is nonplanar and has no planar mesh embedding.',
  'embedding-limit': 'The solver could not establish a planar embedding within its search limit.',
};

/** Solve a verified graph in SI units. Coefficient columns follow meshes order. */
export function solveDcMeshCircuit(graph) {
  const prepared = prepareDcNetwork(graph);
  if (!prepared.ok) return prepared;
  const nodeIds = [...prepared.nodeIds].sort();
  const branches = prepared.branches.toSorted(byId);
  const { faces, error } = embedCircuit(nodeIds, branches);
  if (error) return fail(error === 'disconnected-network' ? error : 'unsupported-method',
    embeddingMessages[error], { reason: error });
  if (faces.length !== branches.length - nodeIds.length + 2) {
    return fail('unsupported-method', 'The embedding did not produce the expected planar faces.');
  }

  const embedding = indexFaces(faces, branches);
  const { meshes, incidence, externalBoundary } = embedding;
  const equations = buildEquations(branches, faces.length, embedding);
  const matrix = equations.filter(({ independent }) => independent)
    .map(({ coefficients, rhs }) => Float64Array.from([...coefficients, rhs]));
  const solved = solveMatrix(matrix);
  if (solved.error) {
    return fail(solved.error, solved.error === 'inconsistent-system'
      ? 'The mesh equations cannot satisfy all circuit constraints.'
      : solved.error === 'singular-system' ? 'The mesh currents are not uniquely determined.'
        : 'The mesh equations exceed floating-point limits.');
  }
  const { solution } = solved;
  const currents = incidence.map((members) =>
    members.reduce((sum, { index, sign }) => sum + sign * solution[index], 0));
  for (const { coefficients, rhs, independent, componentId } of equations) {
    const terms = coefficients.map((coefficient, index) => coefficient * solution[index]);
    const computed = terms.reduce((sum, term) => sum + term, 0);
    const scale = terms.reduce((max, term) => Math.max(max, Math.abs(term)), Math.abs(rhs));
    if (!Number.isFinite(computed) || Math.abs(computed - rhs) > 1e-9 * scale) {
      return independent ? fail('numerical-failure', 'The mesh solution failed an equation residual check.')
        : fail('inconsistent-system', 'The current-source constraints cannot all be satisfied.', { componentId });
    }
  }

  // MNA is run only after the mesh equations have been constructed and solved.
  // In addition to checking currents it rejects a circuit with undetermined
  // source-terminal voltages even if its mesh currents happen to be unique.
  const referenceNodeId = graph.referenceNodeId ?? nodeIds[0];
  const oracle = solveDcCircuit({
    ...graph, nodes: graph.nodes.toSorted(byId), components: graph.components.toSorted(byId),
  }, { referenceNodeId });
  if (!oracle.ok) return oracle;
  const oracleCurrents = new Map(oracle.branches.map(({ componentId, current }) => [componentId, current]));
  const scale = currents.reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  const rounding = 64 * Number.EPSILON * Math.max(1, branches.length) * scale;
  let maxBranchCurrentError = 0;
  for (const [i, branch] of branches.entries()) {
    const expected = oracleCurrents.get(branch.id);
    const difference = Math.abs(currents[i] - expected);
    const tolerance = 1e-9 * Math.max(Math.abs(currents[i]), Math.abs(expected)) + rounding;
    if (!Number.isFinite(difference) || difference > tolerance) {
      return fail('verification-mismatch', 'Mesh and nodal analysis disagree on the branch current.', { componentId: branch.id });
    }
    maxBranchCurrentError = Math.max(maxBranchCurrentError, difference);
  }
  const potentials = meshVoltages(nodeIds, branches, currents);
  if (nodeIds.some((id) => !Number.isFinite(potentials.get(id)))) {
    return fail('numerical-failure', 'The mesh currents did not determine finite node voltages.');
  }
  const voltages = branches.map(({ from, to }) => potentials.get(from.node) - potentials.get(to.node));
  for (const [i, { id, kind, value, from, to }] of branches.entries()) {
    const drop = kind === 'resistance' ? value * currents[i] : value;
    const voltageScale = Math.max(Math.abs(potentials.get(from.node)), Math.abs(potentials.get(to.node)));
    const tolerance = 1e-9 * Math.abs(drop) + 64 * Number.EPSILON * nodeIds.length * voltageScale;
    if (!Number.isFinite(voltages[i]) ||
        (kind !== 'current' && (!Number.isFinite(drop) || Math.abs(voltages[i] - drop) > tolerance))) {
      return fail('numerical-failure', 'The mesh solution failed a branch voltage check.', { componentId: id });
    }
  }
  return {
    ok: true, method: 'mesh-current-analysis', referenceNodeId, externalBoundary, equations,
    meshes: meshes.map((mesh, i) => ({ ...mesh, current: solution[i] })),
    nodes: nodeIds.map((id) => ({ id, voltage: potentials.get(id) })),
    branches: branches.map((branch, i) => ({
      componentId: branch.id, type: branch.type,
      fromTerminal: branch.from.label, toTerminal: branch.to.label,
      fromNodeId: branch.from.node, toNodeId: branch.to.node,
      voltage: voltages[i],
      current: currents[i],
      ...(branch.kind === 'resistance' ? { resistance: branch.value }
        : branch.kind === 'voltage' ? { sourceVoltage: branch.value } : { sourceCurrent: branch.value }),
      meshIncidence: incidence[i].map(({ index, sign }) => ({ meshId: meshes[index].id, sign })),
    })),
    verification: { maxBranchCurrentError },
  };
}
