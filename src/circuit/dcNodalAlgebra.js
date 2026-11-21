/** Express each node as a voltage-source offset from ground or a free node. */
export function nodalPotentials(nodes, sources, reference) {
  const adjacent = new Map(nodes.map(({ id }) => [id, []]));
  for (const { componentId, fromNodeId, toNodeId, sourceVoltage } of sources) {
    adjacent.get(fromNodeId).push({ id: toNodeId, offset: -sourceVoltage, componentId });
    adjacent.get(toNodeId).push({ id: fromNodeId, offset: sourceVoltage, componentId });
  }
  const relations = new Map();
  for (const root of [reference, ...nodes.map(({ id }) => id)]) {
    if (relations.has(root)) continue;
    const variable = root === reference ? null : root;
    const pending = [root];
    relations.set(root, { variable, offset: 0 });
    for (const node of pending) {
      for (const { id, offset, componentId } of adjacent.get(node)) {
        if (relations.has(id)) continue;
        relations.set(id, { variable, offset: relations.get(node).offset + offset, parent: node, componentId });
        pending.push(id);
      }
    }
  }
  return relations;
}

/** Record classroom row operations derived from KCL. MNA provides the
 * answers, and every displayed row is checked at those solved voltages. */
export function traceNodalAlgebra(rows, relations, potentials) {
  const variables = [...relations].filter(([id, { variable }]) => variable === id).map(([id]) => id);
  const equations = new Map(rows.map((row) => [row.nodeId, row.terms]));
  const original = variables.map((id, index) => {
    const coefficients = new Map(variables.map((variable) => [variable, 0]));
    let rhs = 0;
    for (const { fromNodeId, toNodeId, sign, resistance, sourceCurrent } of equations.get(id) ?? []) {
      if (resistance == null) {
        rhs -= sign * sourceCurrent;
        continue;
      }
      for (const [node, orientation] of [[fromNodeId, sign], [toNodeId, -sign]]) {
        const { variable, offset } = relations.get(node);
        if (variable != null) coefficients.set(variable, coefficients.get(variable) + orientation / resistance);
        rhs -= orientation * offset / resistance;
      }
    }
    return { index: index + 1, coefficients: [...coefficients.values()], rhs };
  });
  const asTerms = ({ coefficients }) => variables.flatMap((id, index) => coefficients[index] === 0 ? []
    : [{ id, coefficient: coefficients[index], voltage: potentials.get(id) }]);
  const valid = (row) => {
    const terms = asTerms(row).map(({ coefficient, voltage }) => coefficient * voltage);
    const left = terms.reduce((sum, term) => sum + term, 0);
    const scale = Math.max(Math.abs(row.rhs), ...terms.map(Math.abs));
    return Number.isFinite(scale) && Math.abs(left - row.rhs) <= 1e-8 * scale;
  };
  const describe = (row) => ({ kind: 'nodal-row', index: row.index, terms: asTerms(row), rhs: row.rhs,
    expression: `Equation ${row.index}: ${asTerms(row).map(({ id, coefficient }) => `${coefficient} V[${id}]`).join(' + ')} = ${row.rhs} A` });
  if (original.some((row) => !valid(row))) return null;

  const working = [...original];
  const elimination = [];
  for (const [column, variable] of variables.entries()) {
    const pivot = working[column];
    if (!Number.isFinite(pivot.coefficients[column]) || pivot.coefficients[column] === 0) return null;
    const changes = [];
    for (let index = column + 1; index < working.length; index += 1) {
      const row = working[index];
      if (row.coefficients[column] === 0) continue;
      const factor = row.coefficients[column] / pivot.coefficients[column];
      const reduced = { ...row, rhs: row.rhs - factor * pivot.rhs,
        coefficients: row.coefficients.map((value, col) => col === column ? 0 : value - factor * pivot.coefficients[col]) };
      if (!Number.isFinite(factor) || !valid(reduced)) return null;
      working[index] = reduced;
      changes.push({ ...describe(reduced), factor, pivot: pivot.index });
    }
    if (changes.length) elimination.push({ variable, equations: changes });
  }
  const backSubstitution = variables.map((id, index) => {
    const row = working[index];
    return { kind: 'nodal-isolate', id, coefficient: row.coefficients[index], rhs: row.rhs,
      terms: asTerms(row).filter((term) => term.id !== id), value: potentials.get(id),
      expression: `Isolate V[${id}] in equation ${row.index}.` };
  }).reverse();
  return { original: original.map(describe), elimination, backSubstitution };
}
