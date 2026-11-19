import { termKey } from './electricalGraph.js';

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

  const renderedComponents = new Map(layout.components.map((component) => [component.id, component]));
  const requestedComponents = new Set([...(step.componentIds ?? []), ...(step.branchIds ?? [])]);
  const wireNodes = new Set([...nodes].filter(([, role]) => role !== 'unknown').map(([id]) => id));
  for (const component of graph.components) {
    if (!requestedComponents.has(component.id)) continue;
    const rendered = renderedComponents.get(component.id);
    if (rendered?.type !== component.type || rendered.terminals.length !== component.terminals.length ||
        !component.terminals.every(({ label, node }) =>
          verifiedNodes.get(node)?.has(termKey(component.id, label)) &&
          rendered.terminals.some((terminal) => terminal.label === label && terminal.node === node))) continue;
    componentIds.add(component.id);
    for (const terminal of component.terminals) wireNodes.add(terminal.node);
  }

  for (const wire of layout.allWires ?? layout.wires ?? []) {
    if (!wireNodes.has(wire.node) || !wire.points || wire.points.length < 2) continue;
    const members = verifiedNodes.get(wire.node);
    const belongs = (endpoint) => endpoint === `NODE:${wire.node}` || members.has(endpoint);
    if (belongs(wire.from) && belongs(wire.to)) wireIds.add(wire.id);
  }
  return { nodes, componentIds, wireIds, active: nodes.size > 0 || componentIds.size > 0 || wireIds.size > 0 };
}
