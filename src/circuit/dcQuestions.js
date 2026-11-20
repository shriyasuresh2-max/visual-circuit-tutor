const SUPPORTED_METHOD = /^(?:(?:modified )?nodal analysis|mna|node[- ]voltage(?: method)?|kcl|kirchhoff['’]?s current law)$/i;
const ID = /^(?:[a-z][a-z0-9_.-]*|[0-9]+)$/i;

const requests = [
  ['source-supply', /^(?:current (?:supplied|delivered|provided) by|current from) (.+)$/i],
  ['source-supply', /^what current does (.+?) (?:supply|deliver|provide)$/i],
  ['branch-current', /^(?:(?:how much|what) )?current (?:flows )?(?:through|in|of) (.+)$/i],
  ['resistor-voltage', /^(?:voltage(?: drop)?|potential difference) (?:across|over) (.+)$/i],
  ['resistor-power', /^power (?:dissipated by|consumed by|in|across) (.+)$/i],
  ['node-voltage', /^(?:voltage|potential) (?:at|of) (.+)$/i],
];

/** Interpret a narrow set of DC questions without inferring a missing target. */
export function parseDcQuestion(text) {
  let prompt = (text ?? '').trim().replace(/\s+/g, ' ').replace(/[?.!]+$/, '');
  if (!prompt) return { kind: 'general', asked: false };

  const prefix = prompt.match(/^(?:using|via|by|with|use) (.+?)(?:,\s*| to )(.+)$/i);
  const request = prefix?.[2] ?? prompt;
  const suffix = request.match(/^(.+?)[, ]+(?:using|via|with) (.+)$/i) ??
    request.match(/^(.+)[, ]+by (.+)$/i);
  // "Supplied by V1" and "dissipated by R1" describe a target, not a method.
  const isTarget = suffix && /\b(?:supplied|delivered|provided|dissipated|consumed)$/i.test(suffix[1]);
  const trailingMethod = suffix && !isTarget ? suffix[2] : null;
  if ([prefix?.[1], trailingMethod].some((method) => method && !SUPPORTED_METHOD.test(method))) {
    return { kind: 'unsupported', message: 'The requested method is unavailable. This solver uses modified nodal analysis (MNA).' };
  }
  prompt = trailingMethod ? suffix[1] : prefix?.[2] ?? prompt;
  prompt = prompt
    .replace(/^(?:please )?(?:(?:can|could|would) you )?/i, '')
    .replace(/^please\s+/i, '')
    .replace(/^(?:what (?:is|are)|what['’]s|find|calculate|compute|determine|show(?: me)?|list|give(?: me)?|solve(?: for)?|perform|do)\s+/i, '')
    .replace(/^the\s+/i, '');

  if (/^(?:all )?node voltages$/i.test(prompt)) return { kind: 'node-voltages' };
  if (/^(?:all )?branch currents$/i.test(prompt)) return { kind: 'branch-currents' };
  if (SUPPORTED_METHOD.test(prompt) ||
      /^(?:general (?:dc |nodal )?analysis|(?:the )?circuit|(?:all )?node voltages and (?:all )?branch currents)$/i.test(prompt)) {
    return { kind: 'general', asked: true };
  }
  if (/^current (?:supplied|delivered|provided) by (?:the )?current source$/i.test(prompt)) {
    return { kind: 'source-supply', target: null, sourceType: 'current' };
  }
  if (/^(?:source current|current (?:supplied|delivered|provided) by (?:the )?(?:(?:voltage )?source|battery))$/i.test(prompt)) {
    return { kind: 'source-supply', target: null };
  }

  for (const [kind, pattern] of requests) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const reference = match[1].replace(/^the\s+/i, '');
    const label = reference.replace(/^(?:resistor|node|voltage source|current source|source|battery)\s+/i, '');
    if (/\b(?:and|or)\b|[,/]/i.test(label)) {
      return { kind: 'unsupported', message: 'The question names multiple targets. Ask for one ID or for all node voltages or branch currents.' };
    }
    if (kind === 'source-supply' && /^current source$/i.test(reference)) {
      return { kind, target: null, sourceType: 'current' };
    }
    if (kind === 'source-supply' && /^(?:(?:voltage )?source|battery)$/i.test(reference)) {
      return { kind, target: null };
    }
    if (/^(?:resistor|node|voltage source|current source|source|battery)$/i.test(label) || !ID.test(label)) break;
    return { kind, target: label, resistorOnly: /^resistor\s/i.test(reference) };
  }
  return {
    kind: 'unsupported',
    message: 'Ask for a resistor current, voltage or power, a source’s supplied current, a node voltage, or all node voltages or branch currents. Use the IDs on the schematic.',
  };
}

function findById(items, target, idOf, noun) {
  const exact = items.find((item) => idOf(item) === target);
  if (exact) return { item: exact };
  const matches = items.filter((item) => idOf(item).toLowerCase() === target.toLowerCase());
  if (matches.length === 1) return { item: matches[0] };
  return { message: matches.length > 1
    ? `More than one ${noun} matches “${target}”. Use the exact ID shown on the schematic.`
    : `No ${noun} has the ID “${target}”. Check the schematic for its ID.` };
}

/** Select an answer from one successful solve. Resistor power uses P = VI. */
export function answerDcQuestion(intent, result) {
  if (!result?.ok || intent.kind === 'unsupported' || intent.kind === 'general' ||
      intent.kind === 'node-voltages' || intent.kind === 'branch-currents') {
    return result?.ok ? intent : { kind: 'unavailable' };
  }
  const note = (message) => ({ kind: 'unsupported', message });
  if (intent.kind === 'node-voltage') {
    const { item: node, message } = findById(result.nodes, intent.target, (entry) => entry.id, 'node');
    return node ? { kind: intent.kind, node, referenceNodeId: result.referenceNodeId } : note(message);
  }

  let branch;
  if (intent.target == null) {
    const sourceType = intent.sourceType === 'current' ? 'current' : 'voltage';
    const sources = result.branches.filter((entry) => sourceType === 'current'
      ? entry.sourceCurrent != null : entry.sourceVoltage != null);
    if (sources.length !== 1) return note(sources.length
      ? `More than one ${sourceType} source is present. Name the source ID.`
      : `No independent ${sourceType} source is present.`);
    [branch] = sources;
  } else {
    const match = findById(result.branches, intent.target, (entry) => entry.componentId, 'component');
    if (!match.item) return note(match.message);
    branch = match.item;
  }

  if (intent.kind === 'source-supply' && branch.sourceVoltage == null && branch.sourceCurrent == null) {
    return note(`${branch.componentId} is a resistor. Name a voltage source or current source to ask for supplied current.`);
  }
  if ((intent.resistorOnly || intent.kind.startsWith('resistor-')) && branch.resistance == null) {
    return note(`${branch.componentId} is a ${branch.sourceCurrent != null ? 'current' : 'voltage'} source. Name a resistor for this question.`);
  }

  const value = {
    'branch-current': () => branch.current,
    'source-supply': () => branch.sourceCurrent ?? -branch.current,
    'resistor-voltage': () => branch.voltage,
    'resistor-power': () => branch.voltage * branch.current,
  }[intent.kind]();
  if (!Number.isFinite(value)) return note('The requested quantity is outside the numerical range of this calculation.');
  return { kind: intent.kind, branch, value };
}
