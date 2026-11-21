/** Trace classroom row operations on the solver's independent equations. */
export function traceMeshAlgebra(rows, meshes) {
  const consistent = ({ coefficients, rhs }) => {
    const terms = coefficients.map((coefficient, i) => coefficient * meshes[i].current);
    const sum = terms.reduce((total, term) => total + term, 0);
    const scale = Math.max(Math.abs(rhs), ...terms.map(Math.abs));
    return Number.isFinite(scale) && Number.isFinite(sum) && Math.abs(sum - rhs) <= 1e-9 * scale;
  };
  if (rows.length !== meshes.length || rows.some((row) => !consistent(row))) return null;

  const termsOf = ({ coefficients }) => meshes.flatMap(({ id, current }, i) => coefficients[i] === 0
    ? [] : [{ meshId: id, coefficient: coefficients[i], current }]);
  const working = [...rows];
  const elimination = [];
  for (const [column, { id: meshId }] of meshes.entries()) {
    // Keep the original equation labels when pivoting. No row-swap equation is needed.
    let pivotIndex = column;
    for (let i = column + 1; i < working.length; i += 1) {
      if (Math.abs(working[i].coefficients[column]) > Math.abs(working[pivotIndex].coefficients[column])) pivotIndex = i;
    }
    [working[column], working[pivotIndex]] = [working[pivotIndex], working[column]];
    const pivot = working[column];
    const divisor = pivot.coefficients[column];
    if (!Number.isFinite(divisor) || divisor === 0) return null;
    const changes = [];
    for (let i = column + 1; i < working.length; i += 1) {
      const row = working[i];
      if (row.coefficients[column] === 0) continue;
      const factor = row.coefficients[column] / divisor;
      const reduced = { ...row, rhs: row.rhs - factor * pivot.rhs,
        coefficients: row.coefficients.map((value, col) => col === column ? 0 : value - factor * pivot.coefficients[col]) };
      if (!Number.isFinite(factor) || factor === 0 || !consistent(reduced)) return null;
      working[i] = reduced;
      changes.push({ ...reduced, kind: 'mesh-row', terms: termsOf(reduced),
        pivot: pivot.index, factor, factorUnit: pivot.unit === row.unit ? null : row.unit === 'V' ? 'Ω' : 'A/V',
        expression: `Equation ${row.index} minus ${factor} times equation ${pivot.index}.` });
    }
    if (changes.length) elimination.push({ meshId, changes });
  }
  const isolation = working.map((row, i) => ({
    kind: 'mesh-isolate', meshId: meshes[i].id, value: meshes[i].current, unit: 'A', rowUnit: row.unit,
    index: row.index, rhs: row.rhs, coefficient: row.coefficients[i], terms: termsOf(row).filter(({ meshId }) => meshId !== meshes[i].id),
    expression: `Isolate the current for ${meshes[i].id} in equation ${row.index}.`,
  })).reverse();
  for (const { rhs, terms, coefficient, value } of isolation) {
    const computed = (rhs - terms.reduce((sum, term) => sum + term.coefficient * term.current, 0)) / coefficient;
    const scale = (Math.abs(rhs) + terms.reduce((sum, term) => sum + Math.abs(term.coefficient * term.current), 0)) / Math.abs(coefficient);
    if (!Number.isFinite(computed) || !Number.isFinite(scale) || Math.abs(computed - value) > 1e-9 * Math.max(scale, Math.abs(value))) return null;
  }
  return { elimination, isolation };
}
