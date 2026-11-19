import { describe, expect, it } from 'vitest';
import { lessonEquationTex } from './dcLessonMath.js';

describe('lesson LaTeX', () => {
  it('uses verified terms and both signs in substituted KCL', () => {
    const equation = {
      kind: 'kcl', substituted: true, referenceNodeId: 'N0', equals: 0, unit: 'A',
      terms: [
        { branchId: 'V1', sign: -1 },
        { branchId: 'R1', sign: 1, fromNodeId: 'N2', toNodeId: 'N0', resistance: 4.7 },
      ],
    };
    expect(lessonEquationTex(equation)).toBe(String.raw`- I_{\mathrm{V}_{1}} + \frac{V_{\mathrm{N}_{2}} - 0\,\mathrm{V}}{4.7\,\Omega} = 0\,\mathrm{A}`);
  });

  it('keeps the signed source constraint and source-supply substitution', () => {
    expect(lessonEquationTex({
      kind: 'source-constraint', fromNodeId: 'N1', toNodeId: 'N2', equals: -12.5, unit: 'V',
    })).toBe(String.raw`V_{\mathrm{N}_{1}} - V_{\mathrm{N}_{2}} = -12.5\,\mathrm{V}`);
    const supply = { kind: 'source-supply', id: 'V1', branchCurrent: -0.125, value: 0.125, unit: 'A' };
    expect(lessonEquationTex(supply, 'substitution')).toContain(String.raw`-\bigl(-0.125\,\mathrm{A}\bigr)`);
    expect(lessonEquationTex({ kind: 'branch-current', id: 'V1', value: -0.125, unit: 'mA' }))
      .toContain(String.raw`\approx -0.125\,\mathrm{mA}`);
  });

  it('renders prefixed ohms and rejects arbitrary identifiers and formats', () => {
    expect(lessonEquationTex({ kind: 'reference', nodeId: 'N1', value: 2.2, unit: 'kΩ' }))
      .toContain(String.raw`2.2\,\mathrm{k}\Omega`);
    expect(lessonEquationTex({ kind: 'node-voltage', id: 'N\\htmlClass', value: 0, unit: 'V' })).toBeNull();
    expect(lessonEquationTex({ kind: 'unknown', expression: 'I[raw]' })).toBeNull();
  });
});
