import { displayNumber as lessonNumber } from './electricalDisplay.js';
export { lessonNumber };

const tex = String.raw;
const units = {
  V: tex`\mathrm{V}`, A: tex`\mathrm{A}`, mA: tex`\mathrm{mA}`,
  'Ω': tex`\Omega`, 'kΩ': tex`\mathrm{k}\Omega`, W: tex`\mathrm{W}`, 'A/V': tex`\mathrm{A}/\mathrm{V}`,
};

function identifier(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/i.test(id)) {
    throw new TypeError('Unsupported lesson identifier');
  }
  const split = id.match(/^([a-z]+)(\d+)$/i);
  return split ? tex`\mathrm{${split[1]}}_{${split[2]}}` : tex`\text{${id.replaceAll('_', '\\_')}}`;
}

const symbol = (name, id) => tex`${name}_{${identifier(id)}}`;
const voltage = (id) => symbol('V', id);
const current = (id) => symbol('I', id);
const drop = (id) => symbol(tex`\Delta V`, id);
const resistance = (id) => /^R\d+$/.test(id) ? `R_{${id.slice(1)}}` : symbol('R', id);
const fraction = (numerator, denominator) => tex`\frac{${numerator}}{${denominator}}`;

function numberTex(value) {
  if (!Number.isFinite(value)) throw new TypeError('Unsupported lesson number');
  const [number, exponent] = String(value === 0 ? 0 : value).split('e');
  return exponent == null ? number : tex`${number}\times 10^{${exponent}}`;
}

function quantity(value, unit) {
  if (!Object.hasOwn(units, unit)) throw new TypeError('Unsupported lesson quantity');
  return tex`${numberTex(value)}\,${units[unit]}`;
}

export function lessonSignedQuantityTex(value, unit) {
  return `${value > 0 ? '+' : ''}${quantity(Number(lessonNumber(value)), unit)}`;
}

function potential(id, equation) {
  if (equation.substituted && equation.knownPotentials && Object.hasOwn(equation.knownPotentials, id)) {
    return quantity(equation.knownPotentials[id], 'V');
  }
  return equation.substituted && id === equation.referenceNodeId ? quantity(0, 'V') : voltage(id);
}

function kcl(equation) {
  const terms = equation.terms.map((term, index) => {
    const body = equation.substituted && term.sourceCurrent != null ? tex`\bigl(${quantity(term.sourceCurrent, 'A')}\bigr)`
      : term.resistance == null ? current(term.branchId) : fraction(
      `${potential(term.fromNodeId, equation)} - ${potential(term.toNodeId, equation)}`,
      equation.substituted ? quantity(term.resistance, 'Ω') : resistance(term.branchId),
    );
    return `${term.sign < 0 ? '- ' : index > 0 ? '+ ' : ''}${body}`;
  });
  return `${terms.join(' ') || quantity(0, 'A')} = ${quantity(equation.equals, equation.unit)}`;
}

function answer(equation) {
  const { kind, id, unit, value, direction, resistance: ohms, branchVoltage, branchCurrent } = equation;
  let name;
  let formula;
  let substitution;
  switch (kind) {
    case 'node-voltage':
      name = voltage(id);
      break;
    case 'branch-current':
      name = current(id);
      if (equation.sourceCurrent != null) return { result: `${name} = ${quantity(equation.sourceCurrent, 'A')}` };
      if (ohms != null) {
        formula = fraction(drop(id), resistance(id));
        substitution = fraction(quantity(Number(lessonNumber(branchVoltage)), 'V'), quantity(ohms, 'Ω'));
      }
      break;
    case 'source-supply':
      name = tex`I_{\mathrm{supplied},\,${identifier(id)}}`;
      formula = `-${current(id)}`;
      substitution = tex`-\bigl(${quantity(Number(lessonNumber(branchCurrent)), 'A')}\bigr)`;
      break;
    case 'resistor-voltage':
      name = drop(id);
      formula = `${voltage(direction.fromNodeId)} - ${voltage(direction.toNodeId)}`;
      break;
    case 'resistor-power':
      name = symbol('P', id);
      formula = tex`${drop(id)} \times ${current(id)}`;
      substitution = tex`\bigl(${quantity(Number(lessonNumber(branchVoltage)), 'V')}\bigr) \times \bigl(${quantity(Number(lessonNumber(branchCurrent)), 'A')}\bigr)`;
      break;
    default:
      return null;
  }
  return {
    formula: formula ? `${name} = ${formula}` : null,
    substitution: substitution ? tex`${name} \approx ${substitution}` : null,
    result: tex`${name} \approx ${quantity(Number(lessonNumber(value)), unit)}`,
  };
}

function signedSum(terms, format, zero) {
  return terms.map(({ sign, ...term }, index) =>
    `${sign < 0 ? '- ' : index ? '+ ' : ''}${format(term)}`).join(' ') || zero;
}

function meshEquation(equation, stage) {
  const braces = (value) => tex`\bigl(${value}\bigr)`;
  const substituted = stage === 'substitution';
  const rounded = (value, unit) => unit ? quantity(Number(lessonNumber(value)), unit) : numberTex(Number(lessonNumber(value)));
  const label = (index) => tex`E_{${index}}`;
  const rowUnit = equation.rowUnit ?? equation.unit;
  const coefficientUnit = rowUnit === 'V' ? 'Ω' : null;
  const coefficientSum = (terms, values = false) => signedSum(terms, ({ meshId, coefficient, current: amps }) => {
    const magnitude = Math.abs(coefficient);
    const factor = magnitude === 1 && !coefficientUnit ? '' : braces(rounded(magnitude, coefficientUnit));
    return factor + (values ? braces(rounded(amps, 'A')) : current(meshId));
  }, quantity(0, rowUnit));
  const signedCoefficients = (terms) => terms.map((term) => ({ ...term, sign: Math.sign(term.coefficient) }));
  const meshSum = (terms, numeric = false) => signedSum(terms, ({ meshId, current: amps }) =>
    numeric ? braces(quantity(Number(lessonNumber(amps)), 'A')) : current(meshId), numeric ? quantity(0, 'A') : '0');
  switch (equation.kind) {
    case 'mesh-reference':
      return current(equation.meshId);
    case 'mesh-kvl': {
      const sum = signedSum(equation.terms, (term) => {
        if (term.kind === 'voltage') {
          return substituted ? braces(quantity(term.value, 'V')) : drop(term.componentId);
        }
        const ohms = substituted ? quantity(term.value, 'Ω') : resistance(term.componentId);
        return `${ohms}${braces(meshSum(term.incidence))}`;
      }, '0');
      return `${sum} = ${quantity(0, 'V')}`;
    }
    case 'mesh-current-constraint':
      return `${meshSum(equation.terms)} = ${substituted ? quantity(equation.rhs, 'A') : current(equation.componentId)}`;
    case 'mesh-current-value':
      return tex`${current(equation.meshId)} \approx ${quantity(Number(lessonNumber(equation.value)), 'A')}`;
    case 'mesh-row': {
      if (stage === 'substitution') return null;
      const row = tex`${label(equation.index)}:\quad ${coefficientSum(signedCoefficients(equation.terms))} \approx ${rounded(equation.rhs, equation.unit)}`;
      return equation.pivot == null ? row
        : tex`${label(equation.index)} \leftarrow ${label(equation.index)} - ${braces(rounded(equation.factor, equation.factorUnit))}${label(equation.pivot)} \quad ${row}`;
    }
    case 'mesh-isolate': {
      const name = current(equation.meshId);
      if (stage === 'result') return tex`${name} \approx ${rounded(equation.value, 'A')}`;
      if (substituted && !equation.terms.length) return null;
      const terms = signedCoefficients(equation.terms.map((term) => ({ ...term, coefficient: -term.coefficient })));
      const sum = terms.length ? coefficientSum(terms, substituted) : null;
      const numerator = rounded(equation.rhs, rowUnit) + (sum ? (sum.startsWith('-') ? ' ' : ' + ') + sum : '');
      const expression = tex`${name} \approx ${fraction(numerator, rounded(equation.coefficient, coefficientUnit))}`;
      return substituted ? expression : tex`${label(equation.index)}:\quad ${expression}`;
    }
    case 'mesh-branch-voltage': {
      const name = drop(equation.componentId);
      if (stage === 'result') return tex`${name} \approx ${rounded(equation.value, 'V')}`;
      return substituted ? tex`${name} \approx ${braces(quantity(equation.resistance, 'Ω'))}${braces(rounded(equation.current, 'A'))}`
        : `${name} = ${resistance(equation.componentId)}${current(equation.componentId)}`;
    }
    case 'mesh-node-voltage': {
      const name = voltage(equation.nodeId);
      if (!equation.terms.length) return stage === 'result' ? `${name} = ${quantity(0, 'V')}` : null;
      if (stage === 'result') return tex`${name} \approx ${rounded(equation.value, 'V')}`;
      const sum = signedSum(equation.terms, (term) => substituted ? braces(rounded(term.voltage, 'V')) : drop(term.componentId), quantity(0, 'V'));
      return substituted ? tex`${name} \approx ${quantity(0, 'V')} + ${braces(sum)}` : `${name} = ${voltage(equation.referenceNodeId)} + ${braces(sum)}`;
    }
    case 'mesh-branch-current': {
      const name = current(equation.componentId);
      if (stage === 'formula') return `${name} = ${meshSum(equation.terms)}`;
      if (substituted) return equation.terms.length ? tex`${name} \approx ${meshSum(equation.terms, true)}` : null;
      return tex`${name} \approx ${quantity(Number(lessonNumber(equation.value)), 'A')}`;
    }
    default:
      return null;
  }
}

const terminal = (label) => /^(?:[+−-])$/.test(label) ? label.replace('−', '-') : identifier(label);

function transformationEquation(equation, stage) {
  const rounded = (value, unit) => quantity(Number(lessonNumber(value)), unit);
  switch (equation.kind) {
    case 'transform-source': {
      const toCurrent = equation.direction === 'voltage-to-current';
      const label = toCurrent ? tex`I_{\mathrm{eq}}` : tex`V_{\mathrm{eq}}`;
      if (stage === 'result') return tex`${label} \approx ${rounded(equation.value, toCurrent ? 'A' : 'V')}`;
      const substitution = stage === 'substitution';
      const input = substitution ? quantity(equation.input, toCurrent ? 'V' : 'A')
        : toCurrent ? drop(equation.sourceId) : current(equation.sourceId);
      const ohms = substitution ? quantity(equation.resistance, 'Ω') : resistance(equation.resistorId);
      return `${label} = ${toCurrent ? fraction(input, ohms) : tex`\bigl(${input}\bigr)\bigl(${ohms}\bigr)`}`;
    }
    case 'transform-port': {
      const v = `${voltage(equation.a)} - ${voltage(equation.b)}`;
      if (stage === 'formula') return tex`${v} = V_{\mathrm{oc}} - R_{\mathrm{eq}} I_{\mathrm{out}}`;
      if (stage === 'substitution') return tex`${v} \approx \bigl(${rounded(equation.openVoltage, 'V')}\bigr) - \bigl(${quantity(equation.resistance, 'Ω')}\bigr) I_{\mathrm{out}}`;
      return tex`V_{\mathrm{oc}} \approx ${rounded(equation.openVoltage, 'V')},\quad I_{\mathrm{sc}} \approx ${rounded(equation.shortCurrent, 'A')}`;
    }
    case 'transform-resistance':
      return `R_{\\mathrm{eq}} = ${stage === 'formula' ? resistance(equation.resistorId) : rounded(equation.value, 'Ω')}`;
    case 'transform-recover-resistor': {
      const { id, a, b, va, vb, portVoltage, series, sign, sourceId, openVoltage, resistance: ohms } = equation;
      const port = tex`V_{\mathrm{AB}}`;
      const substituted = stage === 'substitution';
      const parens = (value) => tex`\bigl(${value}\bigr)`;
      const approx = substituted ? tex`\approx` : '=';
      if (equation.part === 'port') return stage === 'result' ? tex`${port} \approx ${rounded(portVoltage, 'V')}`
        : `${port} ${approx} ${substituted ? `${parens(rounded(va, 'V'))} - ${parens(rounded(vb, 'V'))}` : `${voltage(a)} - ${voltage(b)}`}`;
      if (equation.part === 'drop') {
        if (stage === 'result') return tex`${drop(id)} \approx ${rounded(equation.voltage, 'V')}`;
        const measured = substituted ? rounded(portVoltage, 'V') : port;
        const value = series ? `${substituted ? rounded(openVoltage, 'V') : drop(sourceId)} - ${parens(measured)}` : measured;
        return `${drop(id)} ${approx} ${sign < 0 ? '-' : ''}${parens(value)}`;
      }
      if (stage === 'result') return tex`${current(id)} \approx ${rounded(equation.current, 'A')}`;
      return `${current(id)} ${approx} ${fraction(substituted ? rounded(equation.voltage, 'V') : drop(id),
        substituted ? quantity(ohms, 'Ω') : resistance(id))}`;
    }
    case 'transform-original-branch': {
      if (stage !== 'result') return null;
      const { componentId: id, fromTerminal, toTerminal, voltage: volts, current: amps } = equation;
      return tex`\left(${terminal(fromTerminal)}\to${terminal(toTerminal)}\right)\quad ${drop(id)} \approx ${rounded(volts, 'V')},\quad ${current(id)} \approx ${rounded(amps, 'A')}`;
    }
    default:
      return null;
  }
}

function reductionEquation(equation, stage) {
  const bracket = (value) => tex`\bigl(${value}\bigr)`;
  const rounded = (value, unit) => quantity(Number(lessonNumber(value)), unit);
  const approximate = (label, value, unit) => tex`${label} \approx ${rounded(value, unit)}`;
  const equivalent = (symbol, index) => tex`${symbol}_{\mathrm{eq},${index}}`;
  const r = (ref) => ref.equivalentIndex ? equivalent('R', ref.equivalentIndex) : resistance(ref.id);
  const i = (ref) => ref.equivalentIndex ? equivalent('I', ref.equivalentIndex) : current(ref.id);
  const v = (ref) => ref.equivalentIndex ? equivalent(tex`\Delta V`, ref.equivalentIndex) : drop(ref.id);
  const total = tex`R_{\mathrm{total}}`;
  const substituted = stage === 'substitution';
  switch (equation.kind) {
    case 'reduction-group': {
      const label = r(equation);
      if (stage === 'result') return approximate(label, equation.value, 'Ω');
      const terms = equation.terms.map((term) => substituted ? quantity(term.resistance, 'Ω') : r(term));
      const expression = equation.operation === 'series' ? terms.join(' + ')
        : fraction('1', terms.map((term) => fraction('1', term)).join(' + '));
      return `${label} = ${expression}`;
    }
    case 'reduction-total':
      if (stage === 'formula') return `${total} = ${r(equation.load)}`;
      return stage === 'result' ? approximate(total, equation.value, 'Ω') : null;
    case 'reduction-source':
      if (stage === 'result') return approximate(current(equation.id), equation.value, 'A');
      return `${current(equation.id)} ${substituted ? tex`\approx` : '='} -${fraction(
        substituted ? bracket(quantity(equation.voltage, 'V')) : drop(equation.id),
        substituted ? rounded(equation.resistance, 'Ω') : total,
      )}`;
    case 'reduction-load': {
      const { load, sourceId, sign } = equation;
      const amps = i(load);
      const volts = v(load);
      if (stage === 'result') return tex`${approximate(volts, equation.voltage, 'V')},\quad ${approximate(amps, equation.current, 'A')}`;
      const oriented = (label, polarity) => polarity < 0 ? `-${bracket(label)}` : label;
      const knownVoltage = oriented(substituted ? bracket(rounded(equation.sourceVoltage, 'V')) : drop(sourceId), sign);
      const knownCurrent = oriented(substituted ? bracket(rounded(equation.sourceCurrent, 'A')) : current(sourceId), -sign);
      const relation = substituted ? tex`\approx` : '=';
      return tex`${volts} ${relation} ${knownVoltage},\quad ${amps} ${relation} ${knownCurrent}`;
    }
    case 'reduction-sharing': {
      const { parent, child, sign } = equation;
      if (stage === 'result') {
        return tex`${approximate(v(child), equation.voltage, 'V')},\quad ${approximate(i(child), equation.current, 'A')}`;
      }
      const parentQuantity = equation.operation === 'series'
        ? substituted ? rounded(equation.parentCurrent, 'A') : i(parent)
        : substituted ? rounded(equation.parentVoltage, 'V') : v(parent);
      const oriented = sign < 0 ? `-${substituted ? bracket(parentQuantity) : parentQuantity}` : parentQuantity;
      const ohms = substituted ? quantity(equation.resistance, 'Ω') : r(child);
      const relation = substituted ? tex`\approx` : '=';
      return equation.operation === 'series'
        ? tex`${i(child)} ${relation} ${oriented},\quad ${v(child)} ${relation} ${ohms}${bracket(substituted ? rounded(equation.current, 'A') : i(child))}`
        : tex`${v(child)} ${relation} ${oriented},\quad ${i(child)} ${relation} ${fraction(substituted ? rounded(equation.voltage, 'V') : v(child), ohms)}`;
    }
    case 'reduction-branch': {
      if (stage !== 'result') return null;
      const { componentId: id, fromTerminal, toTerminal, voltage: volts, current: amps, power } = equation;
      return tex`\left(${terminal(fromTerminal)}\to${terminal(toTerminal)}\right)\quad
        ${approximate(drop(id), volts, 'V')},\quad ${approximate(current(id), amps, 'A')},\quad
        ${approximate(symbol('P', id), power, 'W')}`;
    }
    default:
      return null;
  }
}

function superpositionEquation(eq, stage) {
  const rounded = (value, unit) => quantity(Number(lessonNumber(value)), unit);
  const bracket = (text) => tex`\bigl(${text}\bigr)`;
  if (eq.kind === 'superposition-power') {
    const power = symbol('P', eq.id);
    if (stage === 'formula') return tex`${power} = ${drop(eq.id)}\,${current(eq.id)}`;
    if (stage === 'substitution') return tex`${power} \approx ${bracket(rounded(eq.voltage, 'V'))}${bracket(rounded(eq.current, 'A'))}`;
    return tex`${power} \approx ${rounded(eq.value, 'W')}`;
  }
  if (eq.kind !== 'superposition-case' && eq.kind !== 'superposition-sum') return null;
  const name = eq.quantity === 'node-voltage' ? voltage(eq.id) : eq.quantity === 'voltage' ? drop(eq.id)
    : eq.quantity === 'supplied' ? tex`I_{\mathrm{supplied},\,${identifier(eq.id)}}` : current(eq.id);
  const dueTo = (label, source) => tex`${label}^{(${identifier(source)})}`;
  const label = eq.sourceId ? dueTo(name, eq.sourceId) : name;
  if (stage === 'result') return tex`${label} \approx ${rounded(eq.value, eq.unit)}`;
  if (eq.kind === 'superposition-sum') {
    const terms = eq.terms.map(({ sourceId, value }) => stage === 'formula'
      ? dueTo(name, sourceId) : bracket(rounded(value, eq.unit)));
    return tex`${name} ${stage === 'formula' ? '=' : '\\approx'} ${terms.join(' + ') || quantity(0, eq.unit)}`;
  }
  const substituted = stage === 'substitution';
  const relation = substituted ? tex`\approx` : '=';
  if (eq.quantity === 'voltage') {
    const from = substituted ? bracket(rounded(eq.fromVoltage, 'V')) : dueTo(voltage(eq.fromNodeId), eq.sourceId);
    const to = substituted ? bracket(rounded(eq.toVoltage, 'V')) : dueTo(voltage(eq.toNodeId), eq.sourceId);
    return `${label} ${relation} ${from} - ${to}`;
  }
  if (eq.quantity === 'current' && eq.resistance != null) {
    const numerator = substituted ? rounded(eq.branchVoltage, 'V') : dueTo(drop(eq.id), eq.sourceId);
    const denominator = substituted ? quantity(eq.resistance, 'Ω') : resistance(eq.id);
    return `${label} ${relation} ${fraction(numerator, denominator)}`;
  }
  if (eq.reversed) {
    const branchCurrent = substituted ? bracket(rounded(eq.branchCurrent, 'A')) : dueTo(current(eq.id), eq.sourceId);
    return `${label} ${relation} -${branchCurrent}`;
  }
  return null;
}

function nodalEquation(eq, stage) {
  const shown = (value) => lessonNumber(value);
  const rounded = (value, unit) => quantity(Number(shown(value)), unit);
  const sum = (terms, valueOf, format) => terms.map((term, i) => {
    const value = valueOf(term);
    return `${value < 0 ? '- ' : i ? '+ ' : ''}${format(term, Math.abs(value))}`;
  }).join(' ');
  const label = (index) => tex`E_{${index}}`;
  switch (eq.kind) {
    case 'nodal-potential': {
      if (stage === 'substitution' && eq.baseVoltage == null) return null;
      const offset = eq.offset === 0 ? '' : ` ${eq.offset < 0 ? '-' : '+'} ${rounded(Math.abs(eq.offset), 'V')}`;
      return stage === 'substitution' ? tex`${voltage(eq.id)} \approx (${rounded(eq.baseVoltage, 'V')})${offset}`
        : `${voltage(eq.id)} = ${voltage(eq.variable)}${offset}`;
    }
    case 'nodal-row': {
      if (stage === 'substitution') return null;
      const terms = sum(eq.terms, (term) => term.coefficient, (term, coefficient) => tex`(${rounded(coefficient, 'A/V')})${voltage(term.id)}`);
      const row = tex`${terms || '0'} \approx ${rounded(eq.rhs, 'A')}`;
      return eq.pivot == null ? `${label(eq.index)}:\quad ${row}`
        : tex`${label(eq.index)} \leftarrow ${label(eq.index)} - (${shown(eq.factor)})${label(eq.pivot)}:\quad ${row}`;
    }
    case 'nodal-isolate': {
      if (stage === 'result') return tex`${voltage(eq.id)} \approx ${rounded(eq.value, 'V')}`;
      const substituted = stage === 'substitution';
      if (substituted && !eq.terms.length) return null;
      const terms = sum(eq.terms, (term) => -term.coefficient, (term, coefficient) =>
        tex`(${rounded(coefficient, 'A/V')})${substituted ? `(${rounded(term.voltage, 'V')})` : voltage(term.id)}`);
      const prepend = terms ? `${terms.startsWith('-') ? ' ' : ' + '}${terms}` : '';
      return tex`${voltage(eq.id)} ${substituted ? '\\approx' : '='} ${fraction(rounded(eq.rhs, 'A') + prepend, rounded(eq.coefficient, 'A/V'))}`;
    }
    case 'nodal-source-current': {
      if (stage === 'result') return tex`${current(eq.id)} \approx ${rounded(eq.value, 'A')}`;
      const substituted = stage === 'substitution';
      const terms = signedSum(eq.terms, (term) => substituted ? `(${rounded(term.value, 'A')})` : current(term.branchId), quantity(0, 'A'));
      return `${current(eq.id)} ${substituted ? '\\approx' : '='} ${terms}`;
    }
    default:
      return null;
  }
}

/** Format only the equation types emitted by the verified lesson. */
export function lessonEquationTex(equation, stage = 'result') {
  try {
    switch (equation.kind) {
      case 'reference':
        return `${voltage(equation.nodeId)} = ${quantity(equation.value, equation.unit)}`;
      case 'unknown-voltage':
        return tex`${voltage(equation.nodeId)}\;\text{is unknown}`;
      case 'unknown-current':
        return tex`${current(equation.branchId)}\;\text{is unknown}`;
      case 'current-direction': {
        return tex`${current(equation.branchId)}:\quad ${identifier(equation.fromNodeId)}\,(${terminal(equation.fromTerminal)}) \to ${identifier(equation.toNodeId)}\,(${terminal(equation.toTerminal)})`;
      }
      case 'kcl':
        return kcl(equation.staged ? { ...equation, substituted: stage === 'substitution' } : equation);
      case 'source-constraint': {
        const values = equation.staged ? { ...equation, substituted: stage === 'substitution' } : equation;
        return `${potential(equation.fromNodeId, values)} - ${potential(equation.toNodeId, values)} = ${
          equation.staged && stage === 'formula' ? drop(equation.componentId) : quantity(equation.equals, equation.unit)}`;
      }
      default:
        return meshEquation(equation, stage) ?? reductionEquation(equation, stage) ?? transformationEquation(equation, stage)
          ?? superpositionEquation(equation, stage) ?? nodalEquation(equation, stage) ?? answer(equation)?.[stage] ?? null;
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
}
