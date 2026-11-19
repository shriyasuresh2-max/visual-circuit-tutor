/**
 * Regression audit for the saved analysis captures.
 *
 * Runs every capture in backend/debug_analyses through the real layout pipeline
 * and reports what the renderer would show, so a change to the layout engine can
 * be checked against the evidence it was built from.
 *
 * Usage:
 *   node scripts/audit-captures.mjs            # summary for every capture
 *   node scripts/audit-captures.mjs --verbose  # plus per-node/junction detail
 *   node scripts/audit-captures.mjs <file>     # one capture, full detail
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutCircuit } from '../src/circuit/circuitLayout.js';

const DIR = 'backend/debug_analyses';
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.find((a) => !a.startsWith('--'));

function loadCaptures() {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
      // Captures wrap the model's structured output in `parsed`; an older shape
      // stored it at the top level.
      const analysis = raw.parsed ?? raw.analysis ?? raw;
      return { file, analysis };
    });
}

function summarize({ file, analysis }) {
  const layout = layoutCircuit(analysis);
  const errors = layout.renderValidation?.errors ?? [];
  const warnings = layout.renderValidation?.warnings ?? [];
  const line = [
    file.replace(/^analysis_|\.json$/g, ''),
    (analysis.circuit_type ?? '?').padEnd(9),
    `ok=${layout.ok}`,
    `valid=${!errors.length}`,
    `errors=${errors.length}`,
    `warn=${warnings.length}`,
    `comps=${layout.components?.length ?? 0}`,
    `nodes=${layout.nodes?.length ?? 0}`,
    `junctions=${(layout.junctions ?? []).length}`,
    `approx=${layout.isApproximation}`,
    (layout.message ?? '').slice(0, 60),
  ].join(' ');
  return { layout, errors, warnings, line };
}

const detail = ({ layout, errors, warnings }) => {
  if (errors.length) {
    console.log('  ERRORS:');
    for (const e of errors) console.log(`   ✗ ${e}`);
  }
  if (warnings.length) {
    console.log('  WARNINGS:');
    for (const w of warnings) console.log(`   ! ${w}`);
  }
  for (const note of layout.geometryNotes ?? []) console.log(`  NOTE: ${note}`);
  for (const d of layout.diagnostics ?? []) if (d.severity !== 'info') console.log(`  DIAG: ${d.message}`);
  for (const n of layout.nodes ?? []) {
    console.log(`  ${n.id} (${n.x},${n.y}) degree=${n.degree} rail=${n.isJunction} src=${n.anchorSource}`);
  }
  for (const j of layout.junctions ?? []) {
    console.log(`  ${j.id} -> ${j.nodeId} (${j.x},${j.y}) src=${j.source ?? '?'} anchor=${Boolean(j.isAnchor)}`);
  }
  for (const c of layout.components ?? []) {
    console.log(`  ${c.id} ${c.type} c=(${Math.round(c.center.x)},${Math.round(c.center.y)}) ` +
      `t=${(c.terminals ?? []).map((t) => `${t.label}:${Math.round(t.x)},${Math.round(t.y)}`).join(' ')}`);
  }
  for (const w of layout.wires ?? []) {
    console.log(`  ${w.id} ${w.node ?? ''} ${w.from} -> ${w.to} ` +
      `${w.points.map((p) => `(${p.x},${p.y})`).join(' ')}${w.isExtracted ? ' [traced]' : ''}`);
  }
};

const captures = loadCaptures().filter((c) => !only || c.file.includes(only));
if (captures.length === 0) {
  console.error(`no capture matching ${only}`);
  process.exit(2);
}

let valid = 0;
for (const capture of captures) {
  const result = summarize(capture);
  console.log(result.line);
  if (result.errors.length === 0) valid += 1;
  else if (!verbose && captures.length > 1) for (const e of result.errors) console.log(`     ✗ ${e}`);
  if (verbose || only) detail(result);
}

console.log(`\n${valid}/${captures.length} captures lay out without render errors.`);
process.exit(valid === captures.length ? 0 : 1);
