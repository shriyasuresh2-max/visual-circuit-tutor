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
  termKey,
  SOURCE_TYPES,
} from './electricalGraph.js';
import { reconcileTopology } from './topologyReconciliation.js';
import {
  layoutSchematic,
  validateSchematic,
  applyEditToComponent,
  rerouteLayout,
  interiorSegmentAt,
  wireSegmentAt,
  wireOverrideKey,
} from './schematicLayout.js';
import {
  findSnapTarget,
  collectSnapTargets,
  snapDistanceForZoom,
  snapTargetLabel,
} from './wireSnap.js';

export {
  computeNodes,
  findCycle,
  ensureTerminals,
  SOURCE_TYPES,
  reconcileTopology,
  applyEditToComponent,
  rerouteLayout,
  interiorSegmentAt,
  wireSegmentAt,
  wireOverrideKey,
  findSnapTarget,
  collectSnapTargets,
  snapDistanceForZoom,
  snapTargetLabel,
};

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
 *
 * Reads the reconciled graph, so an uncertain claim that was withheld from the
 * electrical nodes does not make this summary disagree with the drawing.
 */
export function describeTopology(analysis) {
  const graph = buildGraph(analysis);
  const nodeOf = new Map();
  for (const component of graph.components) {
    for (const terminal of component.terminals) {
      if (terminal.node) nodeOf.set(termKey(component.id, terminal.label), terminal.node);
    }
  }
  const cycle = findCycle(graph.components, nodeOf);
  return {
    componentCount: graph.components.length,
    connectionCount: graph.connections.length,
    nodeCount: graph.nodes.length,
    provisionalCount: graph.provisional.length,
    hasLoop: Boolean(cycle),
    loopLength: cycle ? cycle.length : 0,
  };
}

// buildGraph is used by callers/tests that want the canonical graph directly.
export { buildGraph };
