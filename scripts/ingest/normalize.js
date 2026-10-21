import { normaliseName, isJunkName } from '../../lib/names.js';
import { parseSeason } from '../../lib/seasons.js';

// TM's two position columns, mapped onto the four game positions. The coarse
// `position` column holds Defender/Midfield/Attack/Goalkeeper; the specific
// `sub_position` column holds Centre-Forward, Left-Back and so on. Both vocabularies
// must fold, so the tests' sub-position examples and the real rows both resolve.
// Order matters: "Attacking Midfield" is a Midfielder, not a Forward.
const POSITION_MAP = [
  [/goalkeeper|\bGK\b/i, 'Goalkeeper'],
  [/\bdefender\b|\bCB\b|\bLB\b|\bRB\b|\bLWB\b|\bRWB\b|back|wing[- ]?back/i, 'Defender'],
  [/midfield|\bCM\b|\bCDM\b|\bCAM\b|\bLM\b|\bRM\b/i, 'Midfielder'],
  // "Attack" is the coarse position TM gives a forward; "Missing" deliberately
  // falls through to 'Unknown'.
  [/forward|\battack\b|\bST\b|\bCF\b|\bLW\b|\bRW\b|winger|striker/i, 'Forward'],
];

// The TM competition ids the seed reference holds (db/003_seed_reference.sql).
// A raw value that is already one of these is a league id, not a display name.
const LEAGUE_IDS = new Set(['GB1', 'ES1', 'IT1', 'FR1', 'L1', 'NL1', 'PO1', 'MLS1', 'SA1']);

// Display names, keyed already folded (normaliseName output).
const LEAGUE_ALIASES = {
  'premier league': 'GB1', 'pl': 'GB1',
  'la liga': 'ES1', 'laliga': 'ES1',
  'serie a': 'IT1',
  'ligue 1': 'FR1',
  'bundesliga': 'L1', 'bundes liga': 'L1',
  'eredivisie': 'NL1',
  'primeira liga': 'PO1', 'liga portugal': 'PO1',
  'major league soccer': 'MLS1', 'mls': 'MLS1',
  'saudi pro league': 'SA1',
};

export function normalisePosition(raw) {
  if (!raw) return 'Unknown';
  for (const [re, pos] of POSITION_MAP) if (re.test(raw)) return pos;
  // 'Unknown' is a legal stored value; the quality gate (G4) fails it, not the insert.
  return 'Unknown';
}

export function normaliseLeague(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // A competition id is already a league id and wins outright: 'GB1' -> 'GB1'.
  if (LEAGUE_IDS.has(s)) return s;
  // Otherwise fold a display name; normaliseName already turns '-' and '.' into
  // spaces, so 'la-liga' folds to 'la liga' without a second lookup.
  return LEAGUE_ALIASES[normaliseName(s)] ?? null;
}

function intOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// A money or measurement field of zero never occurs in the real source - the
// source records a blank instead - so zero there means "nothing recorded".
// Missing is null; zero is not a value.
function positiveIntOrNull(v) {
  const n = intOrNull(v);
  return n === null || n <= 0 ? null : n;
}

function dateOnly(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function normalisePlayer(raw) {
  const name = (raw.name ?? '').trim();
  if (!name || isJunkName(name)) return null;
  const dob = dateOnly(raw.date_of_birth);
  if (!dob) return null;
  // No source id means the row cannot be traced back to a source row, so it
  // cannot enter the database. Emptiness, not falsiness: '0' is a real id.
  const sourceKey = String(raw.player_id ?? '').trim();
  if (!sourceKey) return null;

  const citizenship = (raw.country_of_citizenship ?? '').trim();
  return {
    sourceKey,
    name,
    // normaliseName strips the apostrophe without a word break, so "N'Golo
    // Kante" slugs to "ngolo-kante" rather than "n-golo-kante".
    slug: normaliseName(name).replace(/\s+/g, '-'),
    dateOfBirth: dob,
    citizenship: citizenship ? [citizenship] : [],
    position: normalisePosition(raw.position),
    subPosition: (raw.sub_position ?? '').trim() || null,
    preferredFoot: (raw.foot ?? '').trim() || null,
    heightCm: positiveIntOrNull(raw.height_in_cm),
    // A cap or goal count of zero is a real, frequent value in the source; only
    // a blank means "not recorded". These are counts, not measurements.
    internationalCaps: intOrNull(raw.international_caps),
    internationalGoals: intOrNull(raw.international_goals),
    marketValueEur: positiveIntOrNull(raw.market_value_in_eur),
    highestMarketValueEur: positiveIntOrNull(raw.highest_market_value_in_eur),
  };
}

export function normaliseTransfer(raw) {
  const pid = raw.player_id;
  const season = parseSeason(raw.transfer_season);
  if (!pid || season === null) return null;
  const toName = (raw.to_club_name ?? '').trim();
  const fromName = (raw.from_club_name ?? '').trim();
  // A transfer between two junk endpoints ("without club" -> "") says nothing.
  if (isJunkName(toName) && isJunkName(fromName)) return null;
  return {
    playerSourceKey: String(pid),
    season,
    toClubName: isJunkName(toName) ? null : toName,
    fromClubName: isJunkName(fromName) ? null : fromName,
    toClubId: raw.to_club_id ?? null,
    fromClubId: raw.from_club_id ?? null,
    // A free transfer is recorded as a blank fee in the real source, so a
    // positive value is a fee and anything else means "not recorded".
    feeEur: positiveIntOrNull(raw.transfer_fee),
    marketValueEur: positiveIntOrNull(raw.market_value_in_eur),
  };
}

export function resolveClubAliases(clubs, aliases) {
  const out = new Map();
  for (const alias of aliases) {
    const key = normaliseName(alias);
    if (!key) continue;
    // Count every club whose name CONTAINS the alias before resolving anything.
    // The real source holds three Arsenal clubs ("Arsenal FC", "Arsenal Tula",
    // "Arsenal Kyiv"), and an alias that could mean any of them is not
    // resolvable - a wrong club is worse than no club.
    const matches = clubs.filter(c => normaliseName(c.name).includes(key));
    // Exactly one match resolves; zero or many does not (the safe answer).
    if (matches.length === 1) out.set(key, matches[0].id);
  }
  return out;
}
