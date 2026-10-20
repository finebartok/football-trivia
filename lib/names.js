const JUNK = new Set(['', 'without club', 'unknown', 'anonymous', 'n/a', 'na', 'none', '-']);

export function normaliseName(s) {
  if (typeof s !== 'string') return '';
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // An apostrophe inside a name is part of the name, not a word break:
    // "N'Golo Kante" must fold to "ngolo kante", not "n golo kante".
    .replace(/['\u2018\u2019\u02bc]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchKey(s) {
  const n = normaliseName(s);
  if (!n) return '';
  const parts = n.split(' ');
  const last = parts[parts.length - 1];
  const first = parts[0] ?? '';
  return `${first} ${last}`.trim();
}

export function isJunkName(s) {
  return JUNK.has(normaliseName(s));
}
