export function parseSeason(v) {
  if (v === null || v === undefined) return null;
  const raw = String(v).trim();
  if (!raw) return null;
  const head = raw.includes('/') ? raw.split('/')[0] : raw;
  const n = Number.parseInt(head, 10);
  if (Number.isNaN(n)) return null;
  if (n >= 1000) return n;
  return n <= 29 ? 2000 + n : 1900 + n;
}

export function seasonLabel(start) {
  const end = (start + 1) % 100;
  return `${start}/${String(end).padStart(2, '0')}`;
}

export function overlapsSeason(seasons, start, end) {
  const list = seasons || [];
  const lo = start ?? -Infinity;
  const hi = end ?? Infinity;
  return list.some(s => s >= lo && s <= hi);
}
