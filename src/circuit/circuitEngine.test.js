import { describe, it, expect } from 'vitest';
import { solveOhmSeriesCircuit, validateCircuitInputs } from './circuitEngine.js';

describe('Circuit Engine — Ohm Series Circuit Calculation', () => {
  it('calculates standard 12V / 4Ω circuit correctly', () => {
    const result = solveOhmSeriesCircuit({ voltage: 12, resistance: 4 });
    
    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.current).toBe(3);
    expect(result.power).toBe(36);
    expect(result.formatted.current).toBe('3 A');
    expect(result.formatted.power).toBe('36 W');
    expect(result.steps).toHaveLength(4);

    // Verify step 1 contains the voltage
    expect(result.steps[0].mathEquation).toContain('12 V');
    // Verify step 2 contains the resistance
    expect(result.steps[1].mathEquation).toContain('4 Ω');
    // Verify step 3 contains the fraction
    expect(result.steps[2].mathText).toContain('12 V / 4 Ω');
    // Verify step 4 contains the calculated current
    expect(result.steps[3].mathText).toContain('3 A');
  });

  it('handles decimal values accurately', () => {
    const result = solveOhmSeriesCircuit({ voltage: 5, resistance: 2.5 });
    
    expect(result.isValid).toBe(true);
    expect(result.current).toBe(2);
    expect(result.power).toBe(10);
    expect(result.formatted.current).toBe('2 A');
  });

  it('rejects zero resistance as an ideal short circuit', () => {
    const validation = validateCircuitInputs(12, 0);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toMatch(/short circuit/i);

    const result = solveOhmSeriesCircuit({ voltage: 12, resistance: 0 });
    expect(result.isValid).toBe(false);
    expect(result.current).toBeNull();
    expect(result.power).toBeNull();
    expect(result.steps).toHaveLength(0);
  });

  it('rejects negative resistance values', () => {
    const validation = validateCircuitInputs(12, -4);
    expect(validation.isValid).toBe(false);
    expect(validation.error).toMatch(/negative/i);

    const result = solveOhmSeriesCircuit({ voltage: 12, resistance: -4 });
    expect(result.isValid).toBe(false);
    expect(result.current).toBeNull();
  });

  it('handles invalid or empty inputs gracefully', () => {
    expect(validateCircuitInputs('', 4).isValid).toBe(false);
    expect(validateCircuitInputs(12, '').isValid).toBe(false);
    expect(validateCircuitInputs('abc', 4).isValid).toBe(false);
    expect(validateCircuitInputs(12, 'xyz').isValid).toBe(false);
    expect(validateCircuitInputs(NaN, 4).isValid).toBe(false);
  });

  it('supports negative voltages correctly (reversed polarity)', () => {
    const result = solveOhmSeriesCircuit({ voltage: -12, resistance: 4 });
    expect(result.isValid).toBe(true);
    expect(result.current).toBe(-3);
  });

  it('handles zero voltage correctly (de-energized circuit)', () => {
    const result = solveOhmSeriesCircuit({ voltage: 0, resistance: 10 });
    expect(result.isValid).toBe(true);
    expect(result.current).toBe(0);
    expect(result.power).toBe(0);
    expect(result.formatted.current).toBe('0 A');
  });

  it('formats large and tiny numbers cleanly', () => {
    const highVoltage = solveOhmSeriesCircuit({ voltage: 10000, resistance: 10 });
    expect(highVoltage.isValid).toBe(true);
    expect(highVoltage.formatted.voltage).toBe('1.00e+4 V');
    expect(highVoltage.formatted.current).toBe('1.00e+3 A');
  });

  it('handles string numbers passed from input fields', () => {
    const result = solveOhmSeriesCircuit({ voltage: '24', resistance: '8' });
    expect(result.isValid).toBe(true);
    expect(result.current).toBe(3);
    expect(result.power).toBe(72);
  });
});
