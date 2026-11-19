const tex = String.raw;
const units = {
  V: tex`\mathrm{V}`, A: tex`\mathrm{A}`, mA: tex`\mathrm{mA}`,
  'Ω': tex`\Omega`, 'kΩ': tex`\mathrm{k}\Omega`, W: tex`\mathrm{W}`,
};

export const lessonNumber = (value) => String(Number(value.toPrecision(7)));

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

function quantity(value, unit) {
  if (!Number.isFinite(value) || !Object.hasOwn(units, unit)) throw new TypeError('Unsupported lesson quantity');
  const [number, exponent] = String(value).split('e');
  const magnitude = exponent == null ? number : tex`${number}\times 10^{${exponent}}`;
  return tex`${magnitude}\,${units[unit]}`;
}

function potential(id, equation) {
  return equation.substituted && id === equation.referenceNodeId ? quantity(0, 'V') : voltage(id);
}

function kcl(equation) {
  const terms = equation.terms.map((term, index) => {
    const body = term.resistance == null ? current(term.branchId) : fraction(
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
        const terminal = (label) => /^(?:[+−-])$/.test(label) ? label.replace('−', '-') : identifier(label);
        return tex`${current(equation.branchId)}:\quad ${identifier(equation.fromNodeId)}\,(${terminal(equation.fromTerminal)}) \to ${identifier(equation.toNodeId)}\,(${terminal(equation.toTerminal)})`;
      }
      case 'kcl':
        return kcl(equation);
      case 'source-constraint':
        return `${potential(equation.fromNodeId, equation)} - ${potential(equation.toNodeId, equation)} = ${quantity(equation.equals, equation.unit)}`;
      default:
        return answer(equation)?.[stage] ?? null;
    }
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
}
