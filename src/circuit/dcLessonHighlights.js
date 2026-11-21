import { termKey } from './electricalGraph.js';
import { combineMeshBoundaries, mapMeshFaces } from './meshVisualization.js';

/**
 * Resolve lesson keys against the reconciled graph and the current layout.
 * A branch is a component. Its attached wires are routed pieces of either
 * terminal's net, so every eligible piece of that net shares the emphasis.
 */
export function mapLessonHighlights(graph, layout, step) {
  const nodes = new Map();
  const componentIds = new Set();
  const wireIds = new Set();
  if (!step || !graph || graph.incomplete || graph.reconstruction_incomplete ||
      graph.provisional?.length || graph.validation?.isValid === false ||
      graph.topology?.provisional?.length ||
      !layout?.ok || layout.incomplete) return { nodes, componentIds, wireIds, active: false };

  const layoutNodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const verifiedNodes = new Map();
  for (const node of graph.nodes) {
    const rendered = layoutNodes.get(node.id);
    const members = new Set(node.members);
    if (rendered?.members?.length === members.size &&
        new Set(rendered.members).size === members.size && rendered.members.every((key) => members.has(key))) {
      verifiedNodes.set(node.id, members);
    }
  }

  for (const id of step.nodeIds ?? []) {
    if (verifiedNodes.has(id)) nodes.set(id, 'node');
  }
  // Prioritize the equation's subject over other nodes used in its terms.
  const roles = { 'unknown-voltage': 'unknown', kcl: 'kcl', reference: 'reference' };
  for (const equation of step.equations ?? []) {
    if (Object.hasOwn(roles, equation.kind) && nodes.has(equation.nodeId)) {
      nodes.set(equation.nodeId, roles[equation.kind]);
    }
  }
  const supernodeNodes = new Set(step.supernodeNodeIds?.filter((id) => nodes.has(id)));
  for (const id of supernodeNodes) nodes.set(id, 'supernode');

  const renderedComponents = new Map(layout.components.map((component) => [component.id, component]));
  const meshes = new Map([...(step.meshRegion ?? []), ...(step.meshCurrentReferences ?? []).map(({ mesh }) => mesh)]
    .map((mesh) => [mesh.id, mesh]));
  const meshBranches = new Set([...meshes.values()].flatMap(({ boundary }) => boundary.map(({ componentId }) => componentId)));
  const regionBranches = step.meshRegion?.flatMap(({ boundary }) => boundary.map(({ componentId }) => componentId));
  const requestedComponents = new Set(regionBranches ?? [...(step.componentIds ?? []), ...(step.branchIds ?? [])]);
  const meshComponentIds = new Set();
  const meshWireNodes = new Set();
  const meshWireIds = new Set();
  const requestedTerminals = step.terminalKeys && new Set(step.terminalKeys);
  const requestedSupernodeSources = new Set(step.supernodeSourceIds);
  const supernodeSourceIds = new Set();
  const requestedSourceStates = new Map(step.sourceCase?.inactive.map((source) => [source.componentId, source]));
  if (step.sourceCase) requestedSourceStates.set(step.sourceCase.active.componentId, step.sourceCase.active);
  const sourceStates = new Map();
  const branchTerminals = new Set();
  const terminalKeys = new Set();
  const wireNodes = new Set([...nodes].filter(([, role]) => role !== 'unknown').map(([id]) => id));
  for (const component of graph.components) {
    const caseSource = requestedSourceStates.get(component.id);
    if (!caseSource && !requestedComponents.has(component.id) && !meshBranches.has(component.id)) continue;
    const rendered = renderedComponents.get(component.id);
    if (rendered?.type !== component.type || rendered.terminals.length !== component.terminals.length ||
        !component.terminals.every(({ label, node }) =>
          verifiedNodes.get(node)?.has(termKey(component.id, label)) &&
          rendered.terminals.some((terminal) => terminal.label === label && terminal.node === node))) continue;
    if (caseSource?.type === component.type &&
        [[caseSource.fromTerminal, caseSource.fromNodeId], [caseSource.toTerminal, caseSource.toNodeId]]
          .every(([label, node]) => component.terminals.some((terminal) => terminal.label === label && terminal.node === node))) {
      sourceStates.set(component.id, caseSource.replacement ?? 'active');
    }
    if (meshBranches.has(component.id)) {
      meshComponentIds.add(component.id);
      for (const { node } of component.terminals) meshWireNodes.add(node);
    }
    if (!requestedComponents.has(component.id)) continue;
    componentIds.add(component.id);
    if (requestedSupernodeSources.has(component.id) && ['battery', 'voltage_source'].includes(component.type) &&
        component.terminals.every(({ node }) => supernodeNodes.has(node))) supernodeSourceIds.add(component.id);
    for (const terminal of component.terminals) {
      const key = termKey(component.id, terminal.label);
      if (supernodeNodes.size) branchTerminals.add(key);
      if (requestedTerminals) {
        if (requestedTerminals.has(key)) terminalKeys.add(key);
      } else {
        wireNodes.add(terminal.node);
      }
    }
  }

  for (const wire of layout.allWires ?? layout.wires ?? []) {
    if ((!wireNodes.has(wire.node) && !meshWireNodes.has(wire.node)) || !wire.points || wire.points.length < 2) continue;
    const members = verifiedNodes.get(wire.node);
    const belongs = (endpoint) => endpoint === `NODE:${wire.node}` || members.has(endpoint);
    if (!belongs(wire.from) || !belongs(wire.to)) continue;
    if (meshWireNodes.has(wire.node)) meshWireIds.add(wire.id);
    if (wireNodes.has(wire.node) &&
        (!supernodeNodes.size || supernodeNodes.has(wire.node) || branchTerminals.has(wire.from) || branchTerminals.has(wire.to))) wireIds.add(wire.id);
  }
  const faces = meshes.size && layout.renderValidation?.isValid !== false
    ? mapMeshFaces(layout, [...meshes.values()], meshComponentIds, meshWireIds) : new Map();
  const meshArrowFaces = (step.meshCurrentReferences ?? []).flatMap(({ mesh, emphasized }) => {
    const boundary = faces.get(mesh.id);
    return boundary ? [{ meshId: mesh.id, boundary, emphasized }] : [];
  });
  const arrowOverlay = meshArrowFaces.length ? { meshArrowFaces } : {};
  if (step.meshRegion) {
    const meshBoundary = combineMeshBoundaries(step.meshRegion.map(({ id }) => faces.get(id)));
    // Paint only verified perimeter segments. A routed polyline can include
    // conductor beyond the part of it that belongs to the perimeter.
    const boundaryComponents = meshBoundary?.flatMap(({ componentId }) => componentId ? [componentId] : []);
    return { nodes: new Map(), componentIds: new Set(boundaryComponents), wireIds: new Set(),
      meshBoundary, ...arrowOverlay, active: Boolean(meshBoundary) };
  }
  return { nodes, componentIds, wireIds, ...arrowOverlay, ...(requestedTerminals ? { terminalKeys } : {}),
    ...(supernodeSourceIds.size ? { supernodeSourceIds } : {}),
    ...(step.sourceCase ? { sourceStates } : {}),
    active: nodes.size > 0 || componentIds.size > 0 || wireIds.size > 0 };
}
