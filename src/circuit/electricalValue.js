const PREFIX = { '': 1, p: 1e-12, n: 1e-9, 'µ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const UNITS = {
  resistance: /^([pnuµμmkKMG]?)\s*(?:Ω|[Oo][Hh][Mm][Ss]?)$/,
  voltage: /^([pnuµμmkKMG]?)\s*(?:[Vv]|[Vv][Oo][Ll][Tt][Ss]?)$/,
  current: /^([pnuµμmkKMG]?)\s*(?:[Aa]|[Aa][Mm][Pp](?:[Ee][Rr][Ee])?[Ss]?)$/,
};
const BASE_UNITS = { resistance: 'Ω', voltage: 'V', current: 'A' };
const NUMBER = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER_ONLY = new RegExp(`^${NUMBER}$`);
const VALUE = new RegExp(`^(${NUMBER})(.*)$`);

export function dcValueKind(type) {
  if (type === 'resistor') return 'resistance';
  if (type === 'current_source') return 'current';
  return type === 'battery' || type === 'voltage_source' ? 'voltage' : null;
}

/** One strict parser for extracted text, student edits and explicit SI inputs. */
export function parseDcValue(component) {
  const kind = dcValueKind(component?.type);
  if (!kind) return null;
  const extracted = component.valueRaw ?? component.visible_value;
  const raw = extracted ?? component.value;
  const invalid = (status, text = null, rawUnit = null, unit = null) => ({ status, raw, text, rawUnit, unit });
  if (raw == null || (typeof raw === 'string' && !raw.trim())) return invalid('missing-value');
  if (typeof raw !== 'string' && typeof raw !== 'number') return invalid('invalid-value');

  // NFC equates Ω with Ω, but preserves stray marks. Avoid compatibility
  // folding or stripping glyphs that could change an OCR reading.
  let text = normalizeValueText(raw);
  if (extracted == null && component.valueUnit && NUMBER_ONLY.test(text)) {
    text += ` ${normalizeValueText(component.valueUnit)}`;
  }
  const implicitSi = typeof raw === 'number' && extracted == null && !component.valueUnit;
  const match = text.match(VALUE);
  if (!match && !implicitSi) return invalid('invalid-value');
  const [, number = text, suffix = ''] = match ?? [];
  const rawUnit = suffix.trim();
  if (!rawUnit && !implicitSi) return invalid('missing-unit', number);
  const unitMatch = rawUnit.match(UNITS[kind]);
  if ((!unitMatch && !implicitSi) || component.valueUnitRecognized === false) {
    return invalid('invalid-unit', number, rawUnit || null);
  }

  const prefix = (unitMatch?.[1] ?? '').replace(/[uμ]/, 'µ').replace('K', 'k');
  const unit = prefix + BASE_UNITS[kind];
  const normalized = number.replace(',', '.');
  const value = Number(normalized) * PREFIX[prefix];
  const label = `${normalized} ${unit}`;
  if (!Number.isFinite(value) || (value === 0 && /[1-9]/.test(normalized.split(/[eE]/)[0])) ||
      (kind === 'resistance' && (value <= 0 || !Number.isFinite(1 / value)))) {
    return invalid('out-of-range', label, rawUnit || null, unit);
  }
  return { status: 'ok', raw, text: label, unit, rawUnit: rawUnit || null, value };
}

function normalizeValueText(value) {
  return String(value).normalize('NFC').replace(/−/g, '-').trim().replace(/\s+/g, ' ');
}
