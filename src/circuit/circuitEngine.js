/**
 * Pure Circuit Calculation Engine
 * 
 * This module is completely decoupled from React and the UI.
 * It encapsulates Ohm's Law and circuit analysis logic with comprehensive validation.
 * 
 * Formulas:
 *   Ohm's Law:    I = V / R
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
 * Calculates current, power, and step-by-step educational explanations
 * for a closed single-loop DC circuit.
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

  // Step-by-step synchronized educational breakdown
  const steps = [
    {
      stepIndex: 0,
      stepNumber: 1,
      id: 'identify-source',
      highlightTarget: 'source',
      title: 'Step 1: Identify the Voltage Source',
      subtitle: 'Locate the energy provider in the schematic',
      mathEquation: `V = ${formattedV}`,
      explanation: `The circuit is driven by an ideal DC voltage source providing a constant electrical potential difference of ${formattedV}. This voltage acts as the "electrical pressure" pushing charge carriers through the loop.`,
      keyTakeaway: `In Python terms: voltage = ${numV}`
    },
    {
      stepIndex: 1,
      stepNumber: 2,
      id: 'identify-resistor',
      highlightTarget: 'resistor',
      title: 'Step 2: Identify the Circuit Resistance',
      subtitle: 'Locate the passive load opposing current flow',
      mathEquation: `R = ${formattedR}`,
      explanation: `The closed loop contains a single resistive component with an opposition to current of ${formattedR}. The connecting wires are assumed to have 0 Ω resistance (ideal conductors).`,
      keyTakeaway: `In Python terms: resistance = ${numR}`
    },
    {
      stepIndex: 2,
      stepNumber: 3,
      id: 'apply-ohms-law',
      highlightTarget: 'loop',
      title: "Step 3: Select and Apply Ohm's Law",
      subtitle: 'Relate Voltage, Current, and Resistance',
      mathEquation: `I = \\frac{V}{R} = \\frac{${formattedV}}{${formattedR}}`,
      mathText: `I = V / R = ${formattedV} / ${formattedR}`,
      explanation: `Ohm's Law states that current (I) is directly proportional to voltage (V) and inversely proportional to resistance (R). Because this is a single closed series loop, the exact same current flows continuously through every point.`,
      keyTakeaway: `In Python terms: current = voltage / resistance`
    },
    {
      stepIndex: 3,
      stepNumber: 4,
      id: 'interpret-current',
      highlightTarget: 'current',
      title: 'Step 4: Calculate and Interpret the Current',
      subtitle: 'Determine magnitude, direction, and power dissipation',
      mathEquation: `I = ${formattedI} \\quad \\text{and} \\quad P = V \\times I = ${formattedP}`,
      mathText: `I = ${formattedI}  |  P = ${formattedP}`,
      explanation: `Dividing ${formattedV} by ${formattedR} yields a total current of ${formattedI}. Conventional current flows out of the positive battery terminal (+), travels clockwise through the resistor, and returns to the negative terminal (-). The resistor dissipates ${formattedP} of electrical energy as heat.`,
      keyTakeaway: `print("Current", current, "A") → ${formattedI}`
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
