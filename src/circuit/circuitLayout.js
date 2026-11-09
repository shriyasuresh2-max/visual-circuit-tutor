/**
 * circuitLayout — public layout API used by the renderer and the tests.
 *
 * The actual layout work lives in schematicLayout.js (graph-driven node
 * anchors, fixed-size symbols, orthogonal wire routing and geometric
 * validation). This module only keeps the stable import surface:
 *
 *   layoutCircuit(analysis)        → renderable layout
 *   validateRenderedCircuit(lay)   → geometric validation of that layout
 *   describeTopology(analysis)     → quick topology summary
 *   computeNodes / findCycle       → re-exported graph helpers
 */

import {
  buildGraph,
  computeNodes,
  findCycle,
  ensureTerminals,
  SOURCE_TYPES,
} from './electricalGraph.js';
import { layoutSchematic, validateSchematic, applyEditToComponent, rerouteLayout } from './schematicLayout.js';

export { computeNodes, findCycle, ensureTerminals, SOURCE_TYPES, applyEditToComponent, rerouteLayout };

/**
 * Convert an analysis result into positioned, renderable circuit data.
 *
 * @param {Object} analysis - backend CircuitAnalysis object
 * @returns {Object} positioned circuit data for the renderer
 */
export function layoutCircuit(analysis) {
  return layoutSchematic(analysis);
}

/**
 * Validate what will actually be drawn: terminal contact, path continuity,
 * dangling ends, accidental junctions, overlaps and graph agreement.
 *
 * The optional `graph` argument is accepted for backwards compatibility; the
 * validation reads the node assignment carried by the layout itself, so it
 * checks the rendered result rather than the abstract graph.
 */
export function validateRenderedCircuit(layout, graph) {
  const result = validateSchematic(layout);
  if (graph && graph.validation && graph.validation.errors?.length) {
    return {
      ...result,
      errors: [...result.errors, ...graph.validation.errors],
      isValid: result.isValid && graph.validation.errors.length === 0,
    };
  }
  return result;
}

/**
 * Quick topology summary for display.
 */
export function describeTopology(analysis) {
  const components = Array.isArray(analysis?.components) ? analysis.components : [];
  const connections = Array.isArray(analysis?.connections) ? analysis.connections : [];
  const { nodeOf, nodes } = computeNodes(components, connections, analysis?.nodes || []);
  const cycle = findCycle(components, nodeOf);
  return {
    componentCount: components.length,
    connectionCount: connections.length,
    nodeCount: nodes.length,
    hasLoop: Boolean(cycle),
    loopLength: cycle ? cycle.length : 0,
  };
}

// buildGraph is used by callers/tests that want the canonical graph directly.
export { buildGraph };
