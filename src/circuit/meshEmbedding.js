// A rotation is the circular order of directed edge ends at a vertex.
// Following the next end at the destination lists the actual face walks.
function facesOf(rotations, edgeCount) {
  const successor = new Int32Array(2 * edgeCount);
  for (const ends of rotations) {
    for (let i = 0; i < ends.length; i += 1) {
      successor[ends[i] ^ 1] = ends[(i + 1) % ends.length];
    }
  }
  const visited = new Uint8Array(successor.length);
  const faces = [];
  for (let start = 0; start < successor.length; start += 1) {
    if (visited[start]) continue;
    const face = [];
    for (let end = start; !visited[end]; end = successor[end]) {
      visited[end] = 1;
      face.push(end);
    }
    faces.push(face);
  }
  return faces.length ? faces : [[]];
}

// Keep the smallest end first: cyclic shifts describe the same rotation.
function nextRotation(ends) {
  let pivot = ends.length - 2;
  while (pivot >= 1 && ends[pivot] > ends[pivot + 1]) pivot -= 1;
  if (pivot >= 1) {
    let next = ends.length - 1;
    while (ends[next] < ends[pivot]) next -= 1;
    [ends[pivot], ends[next]] = [ends[next], ends[pivot]];
  }
  for (let left = Math.max(1, pivot + 1), right = ends.length - 1; left < right; left += 1, right -= 1) {
    [ends[left], ends[right]] = [ends[right], ends[left]];
  }
  return pivot >= 1;
}

const ROTATION_WORK_LIMIT = 2_000_000;

/** Returns facial walks on a sphere, with the caller choosing its outer face. */
export function embedCircuit(nodeIds, branches) {
  const nodeIndex = new Map(nodeIds.map((id, i) => [id, i]));
  const rotations = nodeIds.map(() => []);
  const loops = nodeIds.map(() => []);
  const groups = [];
  const byPair = new Map();
  const destinations = [];

  // Planarity depends only on the underlying simple graph. Embed that graph,
  // then insert parallel edges consecutively in opposite order at either end,
  // and loops as adjacent pairs. Both operations preserve genus zero.
  branches.forEach(({ from, to }, index) => {
    const a = nodeIndex.get(from.node);
    const b = nodeIndex.get(to.node);
    if (a === b) {
      loops[a].push(2 * index, 2 * index + 1);
      return;
    }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}:${hi}`;
    let group = byPair.get(key);
    if (group === undefined) {
      group = groups.length;
      byPair.set(key, group);
      groups.push([]);
      rotations[lo].push(2 * group);
      rotations[hi].push(2 * group + 1);
      destinations.push(hi, lo);
    }
    groups[group].push(2 * index + Number(a > b));
  });

  const connected = new Set([0]);
  const queue = [0];
  for (let i = 0; i < queue.length; i += 1) {
    for (const end of rotations[queue[i]]) {
      const next = destinations[end];
      if (!connected.has(next)) {
        connected.add(next);
        queue.push(next);
      }
    }
  }
  if (connected.size !== nodeIds.length) return { error: 'disconnected-network' };
  if (nodeIds.length > 2 && groups.length > 3 * nodeIds.length - 6) return { error: 'nonplanar' };

  const expected = groups.length - nodeIds.length + 2;
  const variable = rotations.filter((ends) => ends.length > 2);
  for (let work = 0; work < ROTATION_WORK_LIMIT; work += Math.max(1, 2 * groups.length)) {
    if (facesOf(rotations, groups.length).length === expected) {
      const expanded = rotations.map((ends, node) => ends.flatMap((end) => {
        const parallels = groups[end >> 1];
        return end % 2 === 0 ? parallels : [...parallels].reverse().map((dart) => dart ^ 1);
      }).concat(loops[node]));
      return { faces: facesOf(expanded, branches.length) };
    }
    if (!variable.some(nextRotation)) return { error: 'nonplanar' };
  }
  return { error: 'embedding-limit' };
}
