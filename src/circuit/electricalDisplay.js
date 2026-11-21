// Use local arithmetic scale for the roundoff floor. Cap it in SI units so
// even a very large adjacent signal cannot conceal micro- or nano-scale values.
export function displayZero(value, scale = 0) {
  const floor = Number.isFinite(scale) ? Math.min(1e-12, 32 * Number.EPSILON * Math.abs(scale)) : 0;
  return Math.abs(value) <= floor ? 0 : value;
}

export function displayNumber(value, digits = 7) {
  return String(Number(displayZero(value).toPrecision(digits)));
}

export function displayQuantity(value, unit) {
  const magnitude = Math.abs(value);
  const number = magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e7)
    ? value.toExponential(3) : displayNumber(value, 5);
  return `${number} ${unit}`;
}

/** Display-only context for calculated values. Prescribed source values are
 * retained, even when they are smaller than nearby calculated quantities. */
export function dcDisplayContext(solution) {
  const branches = new Map((solution?.branches ?? []).map((branch) => [branch.componentId, branch]));
  const potentials = new Map((solution?.nodes ?? []).map(({ id, voltage }) => [id, voltage]));
  const nodeScale = new Map();
  const currentScale = new Map();
  for (const { fromNodeId, toNodeId, voltage, current } of branches.values()) {
    const volts = Math.max(Math.abs(potentials.get(fromNodeId) ?? 0), Math.abs(potentials.get(toNodeId) ?? 0), Math.abs(voltage));
    for (const id of [fromNodeId, toNodeId]) {
      nodeScale.set(id, Math.max(volts, nodeScale.get(id) ?? 0));
      currentScale.set(id, Math.max(Math.abs(current), currentScale.get(id) ?? 0));
    }
  }
  const meshScale = (solution?.meshes ?? []).reduce((max, { current }) => Math.max(max, Math.abs(current)), 0);
  return (value, unit, id, kind) => {
    if (kind === 'node') return displayZero(value, nodeScale.get(id));
    if (kind === 'mesh') return displayZero(value, meshScale);
    const branch = branches.get(id);
    if (!branch) return displayZero(value);
    const { fromNodeId, toNodeId, resistance, sourceVoltage, sourceCurrent, current, voltage } = branch;
    const volts = Math.max(Math.abs(potentials.get(fromNodeId) ?? 0), Math.abs(potentials.get(toNodeId) ?? 0));
    const amps = resistance == null ? Math.max(currentScale.get(fromNodeId) ?? 0, currentScale.get(toNodeId) ?? 0) : volts / resistance;
    if (unit === 'V') {
      const scale = sourceVoltage === 0 ? Math.max(nodeScale.get(fromNodeId) ?? 0, nodeScale.get(toNodeId) ?? 0)
        : sourceVoltage == null ? volts : Math.abs(sourceVoltage);
      return displayZero(value, scale);
    }
    if (unit === 'A') return displayZero(value, sourceCurrent == null ? amps : Math.abs(sourceCurrent));
    if (unit === 'W' && (!displayZero(current, amps) || !displayZero(voltage, volts))) return 0;
    return displayZero(value);
  };
}

// Copy only the equation's numeric presentation fields. The solver output,
// contribution tables' underlying data, and animation metadata stay intact.
export function displayEquation(equation, read, cases = new Map(), direct = read) {
  const { kind, id = equation.componentId, unit } = equation;
  const readValue = (value, symbol, key = id, mode) => typeof value === 'number' ? read(value, symbol, key, mode) : value;
  const projected = { ...equation };
  if (kind === 'superposition-case' || kind === 'superposition-sum') {
    const mode = equation.quantity === 'node-voltage' ? 'node' : undefined;
    projected.value = read(equation.value, unit, id, mode);
    if (kind === 'superposition-sum') {
      projected.directValue = direct(equation.directValue, unit, id, mode);
      projected.terms = equation.terms.map((term) => ({ ...term,
        value: (cases.get(term.sourceId) ?? read)(term.value, unit, id, mode) }));
      if (equation.terms.some(({ value }) => value < 0) && equation.terms.some(({ value }) => value > 0)) {
        const scale = equation.terms.reduce((max, { value }) => Math.max(max, Math.abs(value)), 0);
        projected.value = displayZero(projected.value, scale);
        projected.directValue = displayZero(projected.directValue, scale);
      }
    }
  } else if (kind === 'node-voltage' || kind === 'nodal-isolate') {
    projected.value = readValue(equation.value, 'V', id, 'node');
    if (kind === 'nodal-isolate') projected.terms = equation.terms.map((term) => ({ ...term, voltage: readValue(term.voltage, 'V', term.id, 'node') }));
  } else if (kind === 'nodal-source-current') {
    projected.value = readValue(equation.value, 'A');
    projected.terms = equation.terms.map((term) => ({ ...term, value: readValue(term.value, 'A', term.branchId) }));
  } else if (kind === 'mesh-current-value' || kind === 'mesh-isolate') {
    projected.value = readValue(equation.value, 'A', equation.meshId, 'mesh');
    if (kind === 'mesh-isolate') projected.terms = equation.terms.map((term) => ({ ...term, current: readValue(term.current, 'A', term.meshId, 'mesh') }));
  } else if (kind === 'mesh-node-voltage') {
    projected.value = readValue(equation.value, 'V', equation.nodeId, 'node');
    projected.terms = equation.terms.map((term) => ({ ...term, voltage: readValue(term.voltage, 'V', term.componentId) }));
  } else if (kind === 'mesh-branch-voltage') {
    projected.value = readValue(equation.value, 'V');
  } else if (kind === 'mesh-branch-current') {
    projected.value = readValue(equation.value, 'A');
    projected.terms = equation.terms.map((term) => ({ ...term, current: readValue(term.current, 'A', term.meshId, 'mesh') }));
  } else if (['branch-current', 'source-supply', 'resistor-voltage', 'resistor-power', 'reduction-source', 'superposition-power'].includes(kind)) {
    projected.value = readValue(equation.value, unit ?? (kind === 'superposition-power' ? 'W' : 'A'));
  }
  for (const [field, symbol] of [['branchVoltage', 'V'], ['branchCurrent', 'A'], ['voltage', 'V'], ['current', 'A'], ['power', 'W']]) {
    if (field in equation) projected[field] = readValue(equation[field], symbol);
  }
  for (const [field, key] of [['fromVoltage', equation.fromNodeId], ['toVoltage', equation.toNodeId]]) {
    if (field in equation) projected[field] = readValue(equation[field], 'V', key, 'node');
  }
  if (kind === 'superposition-sum') projected.expression = `${equation.label}: ${projected.terms.map(({ value }) => `(${displayQuantity(value, unit)})`).join(' + ') || '0'} = ${displayQuantity(projected.value, unit)}.`;
  else if (unit && typeof projected.value === 'number' && projected.value !== equation.value) {
    projected.expression = `${equation.label ?? id}: ${displayQuantity(projected.value, unit)}.`;
  }
  return projected;
}
