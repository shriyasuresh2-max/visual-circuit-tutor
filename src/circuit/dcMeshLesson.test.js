import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/dc_mesh_tutor_analysis.json';
import parallel from '../../tests/fixtures/dc_current_source_analysis.json';
import singleLoop from '../../tests/fixtures/sample_extracted_analysis.json';
import twoLoops from '../../tests/fixtures/mixed_return_trace_analysis.json';
import threeLoops from '../../tests/fixtures/dc_supernode_analysis.json';
import { buildGraph } from './electricalGraph.js';
import { solveDcCircuit } from './dcSolver.js';
import { solveDcMeshCircuit } from './dcMeshSolver.js';
import { layoutCircuit } from './circuitLayout.js';
import { buildDcMeshLesson } from './dcMeshLesson.js';
import { lessonEquationTex } from './dcLessonMath.js';
import { mapLessonHighlights } from './dcLessonHighlights.js';
import { mapMeshFaces, placeMeshCurrentArrows } from './meshVisualization.js';
import { placeNodeLabels } from './nodeLabels.js';
import { parseDcQuestion } from './dcQuestions.js';

describe('mesh tutoring', () => {
  it('selects reference arrows for the current equations and keeps solved branch flow distinct', () => {
    const graph = buildGraph(twoLoops);
    const layout = layoutCircuit(twoLoops, graph);
    const { steps } = buildDcMeshLesson(solveDcMeshCircuit(graph));
    const arrows = (step) => placeMeshCurrentArrows(mapLessonHighlights(graph, layout, step).meshArrowFaces, layout, placeNodeLabels(layout));
    expect(arrows(steps[0]).map(({ meshId, emphasized }) => [meshId, emphasized])).toEqual([['M1', true]]);
    expect(arrows(steps[1]).map(({ meshId, emphasized }) => [meshId, emphasized])).toEqual([['M2', true]]);
    expect(arrows(steps[2]).map(({ meshId, emphasized }) => [meshId, emphasized])).toEqual([['M1', true], ['M2', false]]);
    expect(arrows(steps[3]).map(({ meshId, emphasized }) => [meshId, emphasized])).toEqual([['M2', true], ['M1', false]]);
    expect(arrows(steps[4])).toHaveLength(2);
    expect(arrows(steps[5])).toEqual([]);
    expect(steps[5].currentArrowMode).toBe('actual');
    expect(arrows(steps[6])).toEqual([]);
    expect(arrows(null)).toEqual([]);
    expect(mapLessonHighlights(graph, { ...layout, renderValidation: { isValid: false } }, steps[0]).meshArrowFaces).toBeUndefined();
  });

  it('draws three verified adjacent faces with separate clearance and ordered sweeps', () => {
    const xs = [0, 110, 200, 330];
    const components = xs.map((x, index) => ({ id: `part${index}`, terminals: [{ x, y: 0, node: 'a' }, { x, y: 120, node: 'b' }] }));
    const wires = ['a', 'b'].map((node, row) => ({ id: node, node, points: xs.map((x) => ({ x, y: row * 120 })) }));
    const meshes = xs.slice(1).map((_, i) => ({ id: `M${i + 1}`, boundary: [
      { componentId: components[i].id, fromNodeId: 'a', toNodeId: 'b' },
      { componentId: components[i + 1].id, fromNodeId: 'b', toNodeId: 'a' },
    ] }));
    // Reverse one traversal to exercise both directions using otherwise identical geometry.
    meshes[1].boundary = meshes[1].boundary.toReversed().map(({ componentId, fromNodeId, toNodeId }) =>
      ({ componentId, fromNodeId: toNodeId, toNodeId: fromNodeId }));
    const layout = { components, wires };
    const faces = mapMeshFaces(layout, meshes, new Set(components.map(({ id }) => id)), new Set(['a', 'b']));
    const references = [...faces].map(([meshId, boundary]) => ({ meshId, boundary, emphasized: true }));
    expect([...faces.values()].every(Boolean)).toBe(true);
    const arrows = placeMeshCurrentArrows(references, layout, [{ box: { minX: 40, maxX: 70, minY: 35, maxY: 85 } }]);
    expect(arrows.map(({ clockwise }) => clockwise)).toEqual([false, true, false]);
    arrows.forEach(({ center, footprint, end, head, clockwise }, i) => {
      expect(center.x - footprint).toBeGreaterThanOrEqual(xs[i]);
      expect(center.x + footprint).toBeLessThanOrEqual(xs[i + 1]);
      expect(center.y - footprint).toBeGreaterThanOrEqual(0);
      expect(center.y + footprint).toBeLessThanOrEqual(120);
      expect(head.every((point) => Math.hypot(point.x - center.x, point.y - center.y) < footprint)).toBe(true);
      const tail = { x: (head[0].x + head[1].x) / 2, y: (head[0].y + head[1].y) / 2 };
      const cross = (end.x - center.x) * (end.y - tail.y) - (end.y - center.y) * (end.x - tail.x);
      expect(cross > 0).toBe(clockwise);
    });
    expect(placeMeshCurrentArrows(references, layout, [{ box: { minX: 0, minY: 0, maxX: 330, maxY: 120 } }])).toEqual([]);
  });

  it.each([
    ['one loop', singleLoop, 3, [-3]],
    ['two coupled loops', twoLoops, 7, [-18 / 7, -6 / 7]],
    ['three loops', threeLoops, 10, [-1, 7 / 3, -1 / 3]],
    ['a supermesh with opposing loop currents', fixture, 7, [1.25, -0.75]],
  ])('uses %s to determine which steps are necessary', (_, analysis, stepCount, expected) => {
    const graph = buildGraph(analysis);
    const result = solveDcMeshCircuit(graph);
    const lesson = buildDcMeshLesson(result);
    expect(lesson.steps).toHaveLength(stepCount);
    const currents = new Map(result.meshes.map(({ id, current }) => [id, current]));
    result.meshes.forEach(({ current }, i) => expect(current).toBeCloseTo(expected[i], 12));
    const solve = lesson.steps.find(({ id }) => id === 'mesh-solution');
    expect(solve.workedEquations.every(({ kind }) => kind === 'mesh-isolate')).toBe(true);
    expect(solve.branchFlows).toBe(result.branches);
    const verifiedRows = new Map();
    const valueOf = (terms, key) => terms.reduce((sum, term) => sum + term[key] * currents.get(term.meshId), 0);
    for (const step of lesson.steps) {
      for (const equation of step.workedEquations ?? []) {
        if (equation.kind === 'mesh-kvl') {
          const left = equation.terms.reduce((sum, term) => sum + term.sign * term.value *
            (term.kind === 'voltage' ? 1 : valueOf(term.incidence, 'sign')), 0);
          expect(left).toBeCloseTo(0, 12);
        } else if (equation.kind === 'mesh-current-constraint') {
          expect(valueOf(equation.terms, 'sign')).toBeCloseTo(equation.rhs, 12);
        } else if (equation.kind === 'mesh-isolate') {
          const current = (equation.rhs - valueOf(equation.terms, 'coefficient')) / equation.coefficient;
          expect(current).toBeCloseTo(equation.value, 12);
          expect(lessonEquationTex(equation, 'formula')).toContain('\\frac');
        }
      }
      for (const row of [...step.equations, ...(step.finalAnswer ?? [])].filter(({ kind }) => kind === 'mesh-row')) {
        expect(valueOf(row.terms, 'coefficient')).toBeCloseTo(row.rhs, 12);
        if (row.pivot) {
          const original = verifiedRows.get(row.index);
          const pivot = verifiedRows.get(row.pivot);
          row.coefficients.forEach((coefficient, index) =>
            expect(coefficient).toBeCloseTo(original.coefficients[index] - row.factor * pivot.coefficients[index], 12));
          expect(row.rhs).toBeCloseTo(original.rhs - row.factor * pivot.rhs, 12);
          expect(lessonEquationTex(row)).toContain('\\leftarrow');
        }
        verifiedRows.set(row.index, row);
      }
    }
  });

  it('keeps the verified branch equations when a simplified row trace fails its checks', () => {
    const result = solveDcMeshCircuit(buildGraph(fixture));
    const equations = result.equations.map((row, i) => i === 0 ? { ...row, coefficients: [0, 0] } : row);
    const lesson = buildDcMeshLesson({ ...result, equations });
    // An independent equation must reconcile with the verified solution to enter the trace.
    const invalid = result.equations.map((row, i) => i === 0 ? { ...row, independent: false } : row);
    const fallback = buildDcMeshLesson({ ...result, equations: invalid }).steps.find(({ id }) => id === 'mesh-solution');
    expect(fallback.explanation).toContain('could not be verified');
    expect(fallback.workedEquations.map(({ kind }) => kind)).toEqual(['mesh-current-constraint', 'mesh-kvl']);
    expect(lesson.steps.some(({ id }) => id.startsWith('eliminate'))).toBe(false);
    expect(buildDcMeshLesson({ ok: false, issues: [{ code: 'unsupported-method' }] })).toBeNull();
  });

  it('works the requested quantity, with other currents kept secondary', () => {
    const result = solveDcMeshCircuit(buildGraph(twoLoops));
    const power = buildDcMeshLesson(result, parseDcQuestion('Power dissipated by R2 using mesh analysis')).steps.at(-1);
    expect(power.componentIds).toEqual(['R2']);
    expect(power.finalAnswer[0].value).toBeCloseTo(6 * (12 / 7) ** 2, 12);
    expect(power.workedEquations.map(({ kind }) => kind)).toEqual(['mesh-branch-current', 'mesh-branch-voltage', 'resistor-power']);
    expect(power.extraEquations).toHaveLength(result.branches.length - 1);
    const askedFor = result.nodes.find(({ id }) => id !== result.referenceNodeId);
    const voltage = buildDcMeshLesson(result, { kind: 'node-voltage', target: askedFor.id }).steps.at(-1).finalAnswer[0];
    expect(voltage.terms.reduce((sum, term) => sum + term.sign * term.voltage, 0)).toBeCloseTo(askedFor.voltage, 12);
    expect(lessonEquationTex(voltage, 'substitution')).toContain('\\mathrm{V}');
    const meshOnly = buildDcMeshLesson(result, { kind: 'mesh-currents' });
    expect(meshOnly.steps.at(-1).id).toBe('mesh-solution');
  });
  it('formats current constraints, supermesh KVL, substitutions, and solved branch currents', () => {
    const graph = buildGraph(fixture);
    const result = solveDcMeshCircuit(graph);
    const nodal = solveDcCircuit(graph);
    expect(result.meshes).toHaveLength(2);
    const lesson = buildDcMeshLesson(result, { kind: 'supermesh' });
    const constraint = lesson.steps.find(({ id }) => id.startsWith('constraint'));
    const [equation] = constraint.workedEquations;
    expect(equation.terms.map(({ sign }) => sign).sort()).toEqual([-1, 1]);
    expect(lessonEquationTex(equation, 'formula')).toContain('I_{\\mathrm{I}_{1}}');
    expect(lessonEquationTex(equation, 'substitution')).toContain('= 2\\,\\mathrm{A}');
    const kvl = lesson.steps.find(({ title }) => title.includes('supermesh KVL'));
    expect(kvl.meshRegion).toHaveLength(2);
    const layout = layoutCircuit(fixture, graph);
    for (const step of [constraint, kvl]) {
      const highlights = mapLessonHighlights(graph, layout, step);
      expect(placeMeshCurrentArrows(highlights.meshArrowFaces, layout).map(({ meshId }) => meshId)).toEqual(['M1', 'M2']);
      expect(highlights.componentIds.has('I1')).toBe(step === constraint);
    }
    expect(kvl.workedEquations[0].terms.map(({ componentId }) => componentId)).not.toContain('I1');
    expect(lessonEquationTex(kvl.workedEquations[0], 'substitution')).toContain('6\\,\\mathrm{V}');
    expect(lesson.steps.indexOf(kvl)).toBeLessThan(lesson.steps.findIndex(({ id }) => id === 'mesh-solution'));
    const final = lesson.steps.at(-1);
    expect(final.currentArrowMode).toBe('actual');
    for (const entry of final.finalAnswer) {
      expect(entry.value).toBeCloseTo(nodal.branches.find(({ componentId }) => componentId === entry.componentId).current);
      expect(lessonEquationTex(entry, 'result')).toContain('\\mathrm{A}');
    }
  });

  it('uses the difference of mesh currents at a shared resistor', () => {
    const analysis = {
      ...parallel,
      components: parallel.components.map((component) => component.id === 'V1'
        ? { ...component, type: 'resistor', visible_value: '1 kohm' } : component),
    };
    const graph = buildGraph(analysis);
    const result = solveDcMeshCircuit(graph);
    const step = buildDcMeshLesson(result).steps.find(({ id }) => id.startsWith('kvl'));
    const text = lessonEquationTex(step.workedEquations[0], 'formula');
    expect(text).toMatch(/\\bigl\(I_\{\\mathrm\{M\}_\{\d\}\} - I_\{\\mathrm\{M\}_\{\d\}\}/);
    expect(lessonEquationTex(step.workedEquations[0], 'substitution')).toContain('1000\\,\\Omega');
  });

  it('maps closed faces and a supermesh while excluding the internal current source from its perimeter', () => {
    const graph = buildGraph(fixture);
    const layout = layoutCircuit(fixture, graph);
    const lesson = buildDcMeshLesson(solveDcMeshCircuit(graph));
    const first = mapLessonHighlights(graph, layout, lesson.steps[0]);
    expect(first.meshBoundary.length).toBeGreaterThan(3);
    expect(first.componentIds.has('I1')).toBe(true);
    const supermesh = lesson.steps.find(({ title }) => title.includes('supermesh KVL'));
    const combined = mapLessonHighlights(graph, layout, supermesh);
    expect(combined.meshBoundary.length).toBeGreaterThan(first.meshBoundary.length);
    expect(combined.componentIds.has('I1')).toBe(false);
    const noWires = { ...layout, wires: [], allWires: [] };
    const fallback = mapLessonHighlights(graph, noWires, supermesh);
    expect(fallback.meshBoundary).toBeNull();
    expect(fallback.active).toBe(false);
    expect(fallback.componentIds.size).toBe(0);
    expect(placeMeshCurrentArrows(fallback.meshArrowFaces, noWires)).toEqual([]);
    expect(supermesh.workedEquations).toHaveLength(1);
  });

  it('refuses to highlight a cycle containing another drawn branch', () => {
    const reordered = {
      ...parallel,
      components: parallel.components.map((component) => ({
        ...component,
        terminals: component.terminals.map((terminal) => ({
          ...terminal, position: { ...terminal.position,
            x: component.id === 'I1' ? 0.5 : component.id === 'V1' ? 0.2 : 0.8 },
        })),
      })),
    };
    const graph = buildGraph(reordered);
    const layout = layoutCircuit(reordered, graph);
    const lesson = buildDcMeshLesson(solveDcMeshCircuit(graph));
    const outerCycle = lesson.steps.find(({ meshRegion }) => meshRegion?.length === 1 &&
      meshRegion[0].boundary.every(({ componentId }) => componentId !== 'I1'));
    expect(outerCycle).toBeDefined();
    const fallback = mapLessonHighlights(graph, layout, outerCycle);
    expect(fallback).toMatchObject({ active: false, meshBoundary: null });
    expect(fallback.meshArrowFaces).toBeUndefined();
  });
});
