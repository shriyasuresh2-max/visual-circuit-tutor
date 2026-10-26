/**
 * Pure Circuit Calculation Engine
 * 
 * This module is completely decoupled from React and the UI.
 * It encapsulates Ohm's Law and circuit analysis logic with comprehensive validation.
 * 
 * Formulas:
 *   Ohm's Law:      I = V / R
 *   Electric Power: P = V * I = I^2 * R
 */

/**
 * Validates input parameters for a basic series circuit.
 * @param {number|string} voltage - Potential difference in Volts (V)
 * @param {number|string} resistance - Resistance in Ohms (Ω)
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateCircuitInputs(voltage, resistance) {
  const v = Number(voltage);
  const r = Number(resistance);

  if (voltage === '' || voltage === null || voltage === undefined || Number.isNaN(v)) {
    return {
      isValid: false,
      error: 'Please enter a valid numeric value for Voltage (V).'
    };
  }

  if (resistance === '' || resistance === null || resistance === undefined || Number.isNaN(r)) {
    return {
      isValid: false,
      error: 'Please enter a valid numeric value for Resistance (Ω).'
    };
  }

  if (!Number.isFinite(v)) {
    return {
      isValid: false,
      error: 'Voltage must be a finite number.'
    };
  }

  if (!Number.isFinite(r)) {
    return {
      isValid: false,
      error: 'Resistance must be a finite number.'
    };
  }

  if (r === 0) {
    return {
      isValid: false,
      error: 'Resistance cannot be 0 Ω. A zero-resistance path creates an ideal short circuit (Current → ∞), which would cause infinite current and violate practical circuit safety.'
    };
  }

  if (r < 0) {
    return {
      isValid: false,
      error: 'Resistance cannot be negative in passive electrical components. R must be greater than 0 Ω.'
    };
  }

  return { isValid: true };
}

/**
 * Calculates current, power, and structured step-by-step educational explanations
 * for a closed single-loop DC circuit.
 * 
 * Each step provides a streamlined 3-part pedagogical sequence:
 *   Part A — What Are We Finding?
 *   Part B — Work It Out (Stage 1: Formula, Stage 2: Substitute Known Values, Stage 3: Calculate Answer)
 *   Part C — What This Means
 * 
 * @param {Object} params
 * @param {number|string} params.voltage - Voltage in Volts
 * @param {number|string} params.resistance - Resistance in Ohms
 * @returns {Object} Circuit solution, formatted numbers, and step breakdown
 */
export function solveOhmSeriesCircuit({ voltage = 12, resistance = 4 } = {}) {
  const validation = validateCircuitInputs(voltage, resistance);

  const numV = Number(voltage);
  const numR = Number(resistance);

  if (!validation.isValid) {
    return {
      isValid: false,
      error: validation.error,
      voltage: Number.isNaN(numV) ? 0 : numV,
      resistance: Number.isNaN(numR) ? 0 : numR,
      current: null,
      power: null,
      formatted: {
        voltage: `${voltage} V`,
        resistance: `${resistance} Ω`,
        current: '—',
        power: '—'
      },
      steps: []
    };
  }

  // Ohm's Law: I = V / R
  const current = numV / numR;

  // Joule's law / Electric Power: P = V * I
  const power = numV * current;

  // Format values cleanly (e.g. integer if exact, else up to 3 decimals)
  const formatNumber = (val) => {
    if (Math.abs(val) >= 1000 || (Math.abs(val) > 0 && Math.abs(val) < 0.01)) {
      return val.toExponential(2);
    }
    return Number.isInteger(val) ? val.toString() : Number(val.toFixed(3)).toString();
  };

  const formattedV = `${formatNumber(numV)} V`;
  const formattedR = `${formatNumber(numR)} Ω`;
  const formattedI = `${formatNumber(current)} A`;
  const formattedP = `${formatNumber(power)} W`;

  // Step-by-step streamlined educational breakdown
  const steps = [
    {
      stepIndex: 0,
      stepNumber: 1,
      id: 'identify-source',
      highlightTarget: 'source',
      title: 'Identify the Voltage Source',
      subtitle: 'Energy source driving charge through the circuit',
      partA: 'Identify the voltage supplied by the battery.',
      partB: {
        stage1Title: 'Stage 1: Formula',
        stage1Formula: 'V',
        stage1Note: 'The battery provides an independent DC electrical potential difference.',
        stage2Title: 'Stage 2: Identify from schematic',
        stage2Formula: `V = ${formattedV}`,
        stage2Note: `From the circuit schematic, the voltage source supplies ${formattedV}.`,
        stage3Title: 'Stage 3: Result',
        stage3Formula: `V = ${formattedV}`,
        stage3Note: 'Known potential difference driving the loop.'
      },
      partC: `The battery provides ${formattedV} of electrical potential difference across the circuit.`,
      mathEquation: `V = ${formattedV}`,
      mathText: `V = ${formattedV}`,
      explanation: `The battery provides ${formattedV} of electrical potential difference across the circuit.`
    },
    {
      stepIndex: 1,
      stepNumber: 2,
      id: 'identify-resistor',
      highlightTarget: 'resistor',
      title: 'Identify Circuit Resistance',
      subtitle: 'Passive load opposing the flow of electric current',
      partA: 'Determine the resistance opposing the current.',
      partB: {
        stage1Title: 'Stage 1: Formula',
        stage1Formula: 'R',
        stage1Note: 'Resistance represents the opposition to the flow of electric charge.',
        stage2Title: 'Stage 2: Identify from schematic',
        stage2Formula: `R = ${formattedR}`,
        stage2Note: `The single series resistor has a value of ${formattedR} (connecting wires have 0 Ω ideal resistance).`,
        stage3Title: 'Stage 3: Result',
        stage3Formula: `R = ${formattedR}`,
        stage3Note: 'Total load resistance in the closed loop.'
      },
      partC: `The ${formattedR} resistor limits the current flowing through the loop.`,
      mathEquation: `R = ${formattedR}`,
      mathText: `R = ${formattedR}`,
      explanation: `The ${formattedR} resistor limits the current flowing through the loop.`
    },
    {
      stepIndex: 2,
      stepNumber: 3,
      id: 'calculate-current',
      highlightTarget: 'current',
      title: 'Calculate the Current',
      subtitle: "Relate voltage, resistance, and current with Ohm's law",
      partA: 'Find how much current flows through the circuit.',
      partB: {
        stage1Title: 'Stage 1: Formula',
        stage1Formula: 'I = V / R',
        stage1Note: "Ohm's law relates current, voltage, and resistance in a closed loop.",
        stage2Title: 'Stage 2: Substitute the known values',
        stage2Formula: `I = ${numV} / ${numR}`,
        stage2Note: `${formattedV} is the supplied voltage and ${formattedR} is the resistance.`,
        stage3Title: 'Stage 3: Calculate the answer',
        stage3Formula: `I = ${formattedI}`,
        stage3Note: `Dividing ${numV} by ${numR} yields a total current of ${formattedI}.`
      },
      partC: `A current of ${formattedI} flows around the closed circuit.`,
      mathEquation: `I = \\frac{V}{R} = \\frac{${formattedV}}{${formattedR}} = ${formattedI}`,
      mathText: `I = V / R = ${formattedV} / ${formattedR} = ${formattedI}`,
      explanation: `A current of ${formattedI} flows around the closed circuit.`
    },
    {
      stepIndex: 3,
      stepNumber: 4,
      id: 'calculate-power',
      highlightTarget: 'power',
      title: 'Calculate Power Dissipation',
      subtitle: 'Determine rate of electrical energy converted into heat',
      partA: 'Calculate how much electrical power the resistor dissipates.',
      partB: {
        stage1Title: 'Stage 1: Formula',
        stage1Formula: 'P = V × I',
        stage1Note: "Joule's law determines the rate at which electrical energy is converted into heat.",
        stage2Title: 'Stage 2: Substitute the known values',
        stage2Formula: `P = ${numV} × ${formatNumber(current)}`,
        stage2Note: `${formattedV} is the voltage across the resistor and ${formattedI} is the circuit current.`,
        stage3Title: 'Stage 3: Calculate the answer',
        stage3Formula: `P = ${formattedP}`,
        stage3Note: `Multiplying ${numV} by ${formatNumber(current)} yields ${formattedP} of power.`
      },
      partC: `The resistor converts ${formatNumber(power)} joules of electrical energy into heat every second.`,
      mathEquation: `P = V \\times I = ${formattedV} \\times ${formattedI} = ${formattedP}`,
      mathText: `P = V * I = ${formattedV} * ${formattedI} = ${formattedP}`,
      explanation: `The resistor converts ${formatNumber(power)} joules of electrical energy into heat every second.`
    }
  ];

  return {
    isValid: true,
    error: null,
    voltage: numV,
    resistance: numR,
    current,
    power,
    formatted: {
      voltage: formattedV,
      resistance: formattedR,
      current: formattedI,
      power: formattedP
    },
    steps
  };
}
