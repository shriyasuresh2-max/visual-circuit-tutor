import React from 'react';
import { lessonNumber } from '../circuit/dcLessonMath.js';

const spans = ({ from, to }, a, b) =>
  (from.node === a && to.node === b) || (from.node === b && to.node === a);

function drawablePair({ source, resistor, internalNodeId }, a, b) {
  if (a === b || resistor.kind !== 'resistance' || ![source.value, resistor.value].every(Number.isFinite) || resistor.value <= 0) return false;
  if (source.kind === 'current') return spans(source, a, b) && spans(resistor, a, b);
  if (source.kind !== 'voltage' || !internalNodeId || [a, b].includes(internalNodeId)) return false;
  return (source.from.node === a && source.to.node === internalNodeId && spans(resistor, internalNodeId, b)) ||
    (source.from.node === internalNodeId && source.to.node === b && spans(resistor, a, internalNodeId));
}

function SourceSymbol({ x, y, source, a, b }) {
  const current = source.kind === 'current';
  const arrowUp = source.from.node === b && source.to.node === a;
  return (
    <g transform={`translate(${x} ${y})`} data-pair-source={source.kind}
      data-reference-direction={current ? (arrowUp ? 'B to A' : 'A to B') : '+ toward A'}>
      <circle r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      {current ? <path d="M0 8 V-8 M-4 -3 L0 -8 L4 -3" transform={arrowUp ? undefined : 'rotate(180)'}
        fill="none" stroke="currentColor" strokeWidth="2" />
        : <path d="M-4 -5 H4 M0 -9 V-1 M-4 6 H4" fill="none" stroke="currentColor" strokeWidth="2" />}
    </g>
  );
}

function Pair({ pair, a, b, transformed }) {
  const { source, resistor } = pair;
  const series = source.kind === 'voltage';
  const sourceFirst = source.from.node === a;
  const label = transformed ? 'Transformed equivalent pair' : 'Original source and resistor';
  return (
    <div>
      <strong>{transformed ? 'After' : 'Before'}</strong>
      <svg viewBox="0 0 132 116" role="img" aria-label={`${label} in ${series ? 'series' : 'parallel'} between ${a} and ${b}`}>
        <path d={series ? 'M58 15 V25 M58 53 V63 M58 91 V101'
          : 'M33 15 V44 M33 72 V101 M33 30 H99 V44 M99 72 V86 H33'} fill="none" stroke="currentColor" strokeWidth="2" />
        <SourceSymbol x={series ? 58 : 33} y={series ? sourceFirst ? 39 : 77 : 58} source={source} a={a} b={b} />
        <path transform={`translate(${series ? 58 : 99} ${series ? sourceFirst ? 77 : 39 : 58})`}
          d="M0 -14 L-5 -10 L5 -6 L-5 -2 L5 2 L-5 6 L5 10 L0 14" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx={series ? 58 : 33} cy="15" r="3" fill="currentColor" />
        <circle cx={series ? 58 : 33} cy="101" r="3" fill="currentColor" />
        <text x={series ? 69 : 13} y="19" fill="currentColor">A</text>
        <text x={series ? 69 : 13} y="105" fill="currentColor">B</text>
      </svg>
      <div className="dc-source-pair-values">
        <span>{transformed ? 'Equivalent source' : source.id} · {lessonNumber(source.value)} {series ? 'V' : 'A'}</span>
        <span>{resistor.id} · {lessonNumber(resistor.value)} Ω</span>
      </div>
    </div>
  );
}

export default function SourceTransformationIllustration({ step }) {
  if (![step.original, step.equivalent].every((pair) => drawablePair(pair, step.a, step.b))) return null;
  return (
    <figure className="dc-source-transformation-illustration" aria-label="Source transformation comparison">
      <figcaption>A = {step.a} · B = {step.b}</figcaption>
      <Pair pair={step.original} a={step.a} b={step.b} />
      <Pair pair={step.equivalent} a={step.a} b={step.b} transformed />
    </figure>
  );
}
