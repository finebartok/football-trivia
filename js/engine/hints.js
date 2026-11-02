import { formatMetric, metricDescriptor } from './stats.js';
import { careerClubs } from './career.js';
import { clauseMatches } from './scope.js';
import { resolveWindow } from './window.js';
import { seasonLabel } from '../../lib/seasons.js';
import { shuffle } from './rng.js';

const ICONS = {
  nat: 'nat', pos: 'pos', path: 'path', shirt: 'shirt', honors: 'honors',
  value: 'value', age: 'age', league: 'league', team: 'team', name: 'name',
};

const LABELS = {
  stage: 'The stage',
  trail: 'The trail',
  record: 'The record',
  profile: 'The profile',
  home: 'The home',
  role: 'The role',
  born: 'The birth year',
  height: 'The height',
  teammate: 'The teammate',
};

const ROLE_RANK = { stage: 0, trail: 1, record: 2, profile: 3, home: 4, role: 3, born: 3, height: 4, teammate: 1 };

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
];

function numberWord(n) {
  return n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n);
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function nationalityOf(player) {
  return player?.nationality ?? player?.citizenship?.[0] ?? null;
}

function hint(role, value, { iconKey, family = 'career', metric = null, windowId = null, id = null, teammateId = null } = {}) {
  const surface = role === 'profile' || role === 'home' || role === 'role' || role === 'born' || role === 'height';
  return {
    id: id ?? role,
    label: LABELS[role],
    value,
    iconKey: iconKey ?? ICONS.honors,
    family,
    surface,
    role,
    ...(metric ? { metric } : {}),
    ...(windowId ? { window: windowId } : {}),
    ...(teammateId ? { teammateId } : {}),
  };
}

// ---------------------------------------------------------------------------
// The stage: the number that put this player in the vibe.
// ---------------------------------------------------------------------------

function seasonSpan(seasons) {
  const first = Math.min(...seasons);
  const last = Math.max(...seasons);
  return first === last ? seasonLabel(first) : `${first}–${last}`;
}

function stageFromStat(subject, stat) {
  const id = stat?.metric;
  const value = id === 'international_caps' ? subject.internationalCaps
    : id === 'international_goals' ? subject.internationalGoals
      : id === 'highest_market_value_eur' ? subject.highestMarketValueEur
        : id === 'club_appearances' ? subject.stats?.club_appearances
          : subject.stats?.[id];
  if (value === undefined || value === null || value <= 0) return null;

  const family = metricDescriptor(id)?.family ?? 'career';
  const base = { family, metric: id };
  switch (id) {
    case 'international_caps':
      return hint('stage', `A ${value}-cap international.`, { ...base, iconKey: ICONS.honors });
    case 'international_goals':
      return hint('stage', `${value} international ${plural(value, 'goal', 'goals')}.`, { ...base, iconKey: ICONS.honors });
    case 'club_goals':
      return hint('stage', `${value} club goals since 2012.`, { ...base, iconKey: ICONS.honors });
    case 'club_appearances':
      return hint('stage', `${value} appearances since 2012.`, { ...base, iconKey: ICONS.honors });
    case 'goals_after_age_30':
      return hint('stage', `Since 2012, ${value} goals after turning 30.`, { ...base, iconKey: ICONS.honors });
    case 'highest_market_value_eur':
      return hint('stage', `${formatMetric(id, value)} peak value.`, { ...base, iconKey: ICONS.value });
    default:
      return null;
  }
}

function stageFromLeague(subject, clause, registry) {
  const leagueIds = new Set(clause.leagues ?? []);
  const teams = (subject.teams ?? []).filter((team) => leagueIds.has(team.leagueId));
  const seasons = [...new Set(teams.flatMap((team) => (team.seasons ?? [])
    .filter((season) => (clause.seasonStart == null || season >= clause.seasonStart)
      && (clause.seasonEnd == null || season <= clause.seasonEnd))))].sort((a, b) => a - b);
  if (!seasons.length) return null;

  const league = teams[0]?.leagueName
    ?? registry?.leagues?.[clause.leagues[0]]
    ?? 'the league';
  const count = seasons.length;
  return hint('stage', `${capitalize(numberWord(count))} ${plural(count, 'season', 'seasons')} in ${league}, ${seasonSpan(seasons)}.`, {
    iconKey: ICONS.league,
    windowId: `range-${clause.leagues[0]}-${clause.seasonStart ?? '*'}-${clause.seasonEnd ?? '*'}`,
  });
}

function stageFromClub(subject, clause) {
  const clubIds = new Set(clause.teams ?? []);
  const teams = (subject.teams ?? []).filter((team) => clubIds.has(team.clubId));
  if (!teams.length) return null;
  const team = [...teams].sort((a, b) => (b.seasons?.length ?? 0) - (a.seasons?.length ?? 0))[0];
  const seasons = (team.seasons ?? [])
    .filter((season) => (clause.seasonStart == null || season >= clause.seasonStart)
      && (clause.seasonEnd == null || season <= clause.seasonEnd));
  if (!seasons.length) return null;

  const count = seasons.length;
  return hint('stage', `${capitalize(numberWord(count))} ${plural(count, 'season', 'seasons')} at ${team.clubName}, ${seasonSpan(seasons)}.`, {
    iconKey: ICONS.team,
  });
}

function stageFromNation(subject, clause) {
  const nations = new Set(clause.nationalities ?? []);
  const nation = (subject.citizenship ?? []).find((c) => nations.has(c)) ?? nationalityOf(subject);
  const goals = subject.internationalGoals;
  if (goals > 0) {
    return hint('stage', `${goals} international ${plural(goals, 'goal', 'goals')}${nation ? ` for ${nation}` : ''}.`, {
      family: 'career', metric: 'international_goals', iconKey: ICONS.honors,
    });
  }
  const caps = subject.internationalCaps;
  if (caps > 0) {
    return hint('stage', `${caps} caps${nation ? ` for ${nation}` : ''}.`, {
      family: 'career', metric: 'international_caps', iconKey: ICONS.honors,
    });
  }
  return null;
}

function stageFromTournament(subject, tournamentId, registry) {
  const window = resolveWindow({ clauses: [{ tournaments: [tournamentId] }] }, registry)
    ?? { id: tournamentId, kind: 'tournament', label: tournamentId };
  const goals = subject.windows?.[tournamentId]?.goals;
  if (goals > 0) {
    return hint('stage', `${goals} ${plural(goals, 'goal', 'goals')} at the ${window.label ?? 'tournament'}.`, {
      family: 'roster', metric: 'tournament_goals', iconKey: ICONS.honors, windowId: tournamentId,
    });
  }
  if ((subject.tournaments ?? []).includes(tournamentId)) {
    return hint('stage', `In the ${window.label ?? 'tournament'} squad.`, {
      family: 'roster', iconKey: ICONS.honors, windowId: tournamentId,
    });
  }
  return null;
}

function stageFromWindow(subject, window, registry) {
  if (!window) return null;
  if (window.kind === 'tournament' && window.id) {
    return stageFromTournament(subject, window.id, registry);
  }
  if (window.kind === 'age_band') {
    const goals = subject.stats?.goals_after_age_30;
    if (goals > 0) {
      return hint('stage', `Since 2012, ${goals} goals after turning 30.`, {
        family: 'window', metric: 'goals_after_age_30', iconKey: ICONS.honors, windowId: window.id,
      });
    }
    return null;
  }
  if (window.kind === 'season_range' && window.leagueId) {
    return stageFromLeague(subject, {
      leagues: [window.leagueId], seasonStart: window.seasonStart, seasonEnd: window.seasonEnd,
    }, registry);
  }
  if (window.id && subject.windows?.[window.id]) {
    const goals = subject.windows[window.id].goals;
    if (goals > 0) {
      return hint('stage', `${goals} ${plural(goals, 'goal', 'goals')} in ${window.label ?? 'that season'}.`, {
        family: 'window', metric: 'club_goals', iconKey: ICONS.honors, windowId: window.id,
      });
    }
  }
  return null;
}

function stageFromClause(subject, clause, registry) {
  for (const stat of clause.stats ?? []) {
    const stage = stageFromStat(subject, stat);
    if (stage) return stage;
  }
  for (const tournamentId of clause.tournaments ?? []) {
    const stage = stageFromTournament(subject, tournamentId, registry);
    if (stage) return stage;
  }
  if (clause.leagues?.length) {
    const stage = stageFromLeague(subject, clause, registry);
    if (stage) return stage;
  }
  if (clause.teams?.length) {
    const stage = stageFromClub(subject, clause);
    if (stage) return stage;
  }
  if (clause.nationalities?.length) {
    const stage = stageFromNation(subject, clause);
    if (stage) return stage;
  }
  return null;
}

function defaultStage(subject) {
  const clubGoals = subject.stats?.club_goals;
  if (clubGoals > 0) {
    return hint('stage', `${clubGoals} club goals since 2012.`, {
      family: 'window', metric: 'club_goals', iconKey: ICONS.honors,
    });
  }
  const caps = subject.internationalCaps;
  if (caps > 0) {
    return hint('stage', `A ${caps}-cap international.`, {
      family: 'career', metric: 'international_caps', iconKey: ICONS.honors,
    });
  }
  const goals = subject.internationalGoals;
  if (goals > 0) {
    return hint('stage', `${goals} international ${plural(goals, 'goal', 'goals')}.`, {
      family: 'career', metric: 'international_goals', iconKey: ICONS.honors,
    });
  }
  const market = subject.highestMarketValueEur;
  if (market > 0) {
    return hint('stage', `${formatMetric('highest_market_value_eur', market)} peak value.`, {
      family: 'career', metric: 'highest_market_value_eur', iconKey: ICONS.value,
    });
  }
  return null;
}

function stageHint(subject, { window, scope, registry } = {}) {
  for (const clause of scope?.clauses ?? []) {
    if (!clauseMatches(clause, subject)) continue;
    const stage = stageFromClause(subject, clause, registry);
    if (stage) return stage;
  }
  return stageFromWindow(subject, window, registry) ?? defaultStage(subject);
}

// ---------------------------------------------------------------------------
// The record: how the player compares with the vibe's own pool.
// ---------------------------------------------------------------------------

function tournamentGoals(player, window) {
  if (window?.kind !== 'tournament' || !window.id) return undefined;
  return player.windows?.[window.id]?.goals;
}

// A record only claims what the vibe's data can prove. Below this share of
// known values, the comparison is too thin to state.
const MIN_RECORD_COVERAGE = 0.8;

const RECORD_DEFS = [
  {
    id: 'international_goals', priority: 0, family: 'career',
    value: (player) => player.internationalGoals,
    phrase: (value) => `${value} international ${plural(value, 'goal', 'goals')}`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
  {
    id: 'international_caps', priority: 1, family: 'career',
    value: (player) => player.internationalCaps,
    phrase: (value) => `${value} caps`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
  {
    id: 'club_goals', priority: 2, family: 'window',
    value: (player) => player.stats?.club_goals,
    phrase: (value) => `${value} club goals since 2012`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
  {
    id: 'goals_after_age_30', priority: 3, family: 'window',
    value: (player) => player.stats?.goals_after_age_30,
    phrase: (value) => `Since 2012, ${value} goals after turning 30`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
  {
    id: 'highest_market_value_eur', priority: 4, family: 'career',
    value: (player) => player.highestMarketValueEur,
    phrase: (value) => `${formatMetric('highest_market_value_eur', value)} peak value`,
    best: 'the highest in this vibe',
    jointBest: 'the joint-highest in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe went higher`,
  },
  {
    id: 'tournament_goals', priority: 5, family: 'roster', needsTournament: true,
    value: tournamentGoals,
    phrase: (value, window) => `${value} ${plural(value, 'goal', 'goals')} at the ${window?.label ?? 'tournament'}`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
  {
    id: 'club_appearances', priority: 6, family: 'window',
    value: (player) => player.stats?.club_appearances,
    phrase: (value) => `${value} appearances since 2012`,
    best: 'the most in this vibe',
    jointBest: 'the joint-most in this vibe',
    higher: (n) => `only ${n} ${plural(n, 'player', 'players')} in this vibe ${n === 1 ? 'has' : 'have'} more`,
  },
];

function poolComparison(rank, ties, total, def) {
  if (rank === 1) return ties > 1 ? def.jointBest : def.best;
  const exclusive = Math.min(5, Math.max(2, Math.ceil(total * 0.1)));
  if (rank <= exclusive) return def.higher(rank - 1);
  if (rank <= Math.ceil(total * 0.1)) return "in this vibe's top 10%";
  if (rank <= Math.ceil(total * 0.25)) return "in this vibe's top quarter";
  if (rank <= Math.ceil(total * 0.5)) return "in this vibe's top half";
  return null;
}

export function recordHints(subject, pool, stage, window) {
  if (!Array.isArray(pool) || pool.length < 2) return [];
  const candidates = [];

  for (const def of RECORD_DEFS) {
    if (stage?.metric === def.id) continue;
    if (def.needsTournament && window?.kind !== 'tournament') continue;
    const value = def.value(subject, window);
    if (value === undefined || value === null || value <= 0) continue;

    // A zero is a known value; only the comparison itself needs positives.
    const known = pool
      .map((player) => def.value(player, window))
      .filter((v) => v !== undefined && v !== null);
    if (known.length / pool.length < MIN_RECORD_COVERAGE) continue;

    const values = known.filter((v) => v > 0);
    if (values.length < 2) continue;

    const rank = 1 + values.filter((v) => v > value).length;
    const ties = values.filter((v) => v === value).length;
    const comparison = poolComparison(rank, ties, values.length, def);
    if (!comparison) continue;

    candidates.push({ def, value, comparison, rank, ties });
  }

  candidates.sort((a, b) => a.rank - b.rank || a.ties - b.ties || a.def.priority - b.def.priority);
  return candidates.map((chosen) => hint('record', `${chosen.def.phrase(chosen.value, window)} — ${chosen.comparison}.`, {
    id: `record-${chosen.def.id}`,
    family: chosen.def.family,
    metric: chosen.def.id,
    iconKey: chosen.def.id === 'highest_market_value_eur' ? ICONS.value : ICONS.honors,
    windowId: chosen.def.needsTournament ? window?.id : null,
  }));
}

function recordHint(subject, pool, stage, window) {
  return recordHints(subject, pool, stage, window)[0] ?? null;
}

// ---------------------------------------------------------------------------
// The trail, the profile and the home: the player, told as a story.
// ---------------------------------------------------------------------------

function trailHint(subject) {
  const path = careerClubs(subject);
  if (path.length < 2) return null;
  return hint('trail', path.join(' → '), { iconKey: ICONS.path });
}

function roleNoun(subject) {
  const raw = subject.subPosition ?? subject.position;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.endsWith('midfield')) return `${lower.slice(0, -'midfield'.length)}midfielder`.trim();
  if (lower === 'midfield') return 'midfielder';
  if (lower === 'attack') return 'forward';
  if (lower === 'defence' || lower === 'defense') return 'defender';
  return lower;
}

function profileHint(subject) {
  const role = roleNoun(subject);
  const foot = subject.foot
    ? (subject.foot.toLowerCase() === 'both' ? 'two-footed' : `${subject.foot.toLowerCase()}-footed`)
    : null;
  const born = subject.dateOfBirth ? String(subject.dateOfBirth).slice(0, 4) : null;

  const parts = [];
  if (role) parts.push(`A ${foot ? `${foot} ` : ''}${role}`);
  else if (foot) parts.push(`A ${foot} player`);
  if (born) parts.push(`${parts.length ? 'born' : 'Born'} in ${born}`);
  if (!parts.length) return null;

  return hint('profile', `${parts.join(', ')}.`, { iconKey: ICONS.pos });
}

export function profileHints(subject) {
  const out = [];
  const role = roleNoun(subject);
  const foot = subject.foot
    ? (subject.foot.toLowerCase() === 'both' ? 'two-footed' : `${subject.foot.toLowerCase()}-footed`)
    : null;

  if (role) out.push(hint('role', `A ${foot ? `${foot} ` : ''}${role}.`, { iconKey: ICONS.pos }));

  const born = subject.dateOfBirth ? String(subject.dateOfBirth).slice(0, 4) : null;
  if (born) out.push(hint('born', `Born in ${born}.`, { iconKey: ICONS.age }));

  const home = homeHint(subject);
  if (home) out.push(home);

  const height = Number(subject.heightCm);
  if (Number.isFinite(height) && height > 0) {
    out.push(hint('height', `${height} cm tall.`, { iconKey: ICONS.age }));
  }

  return out;
}

function homeHint(subject) {
  const nationality = nationalityOf(subject);
  if (!nationality) return null;
  return hint('home', `From ${nationality}.`, { iconKey: ICONS.nat });
}

function clubSeasonIndex(pool) {
  const index = new Map();
  for (const player of pool ?? []) {
    for (const team of player.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const key = `${team.clubId}|${season}`;
        if (!index.has(key)) {
          index.set(key, {
            clubId: team.clubId,
            clubName: team.clubName,
            season,
            players: new Set(),
          });
        }
        index.get(key).players.add(player.id);
      }
    }
  }
  return index;
}

export function teammateHints(subject, pool, { rng = Math.random, limit = 3 } = {}) {
  if (!subject || !Array.isArray(pool)) return [];

  const index = clubSeasonIndex(pool);
  const byId = new Map(pool.map((player) => [player.id, player]));
  const entries = [];
  const seen = new Set([subject.id]);

  for (const team of subject.teams ?? []) {
    for (const season of team.seasons ?? []) {
      const bucket = index.get(`${team.clubId}|${season}`);
      if (!bucket) continue;
      for (const id of bucket.players) {
        if (seen.has(id)) continue;
        const player = byId.get(id);
        if (!player) continue;
        seen.add(id);
        entries.push({ player, clubId: team.clubId, clubName: team.clubName, season });
      }
    }
  }

  if (entries.length < 2) return [];

  const shuffled = shuffle(rng, entries);
  const picked = [];
  const usedClubs = new Set();
  const usedSeasons = new Set();

  // Prefer a different club and a different season for each name.
  for (const entry of shuffled) {
    if (picked.length >= limit) break;
    if (usedClubs.has(entry.clubId) || usedSeasons.has(entry.season)) continue;
    picked.push(entry);
    usedClubs.add(entry.clubId);
    usedSeasons.add(entry.season);
  }
  for (const entry of shuffled) {
    if (picked.length >= limit) break;
    if (!picked.includes(entry)) picked.push(entry);
  }

  return picked.map((entry) => hint(
    'teammate',
    `Played with ${entry.player.name} at ${entry.clubName} in ${seasonLabel(entry.season)}.`,
    {
      id: `teammate-${entry.player.id}`,
      family: 'teammate',
      iconKey: ICONS.team,
      teammateId: entry.player.id,
    },
  ));
}

// ---------------------------------------------------------------------------
// The hook: one true line that makes the question feel specific.
// ---------------------------------------------------------------------------

function leagueCount(player) {
  return new Set((player.teams ?? []).map((team) => team.leagueId).filter(Boolean)).size;
}

function hasWorldCupGoal(player) {
  return Object.entries(player.windows ?? {})
    .some(([id, values]) => id.startsWith('wc-') && (values?.goals ?? 0) > 0);
}

function clubGoals(player) {
  return player.stats?.club_goals ?? 0;
}

const HOOKS = [
  {
    id: 'club-500', metric: 'club_goals',
    test: (player) => clubGoals(player) >= 500,
    text: () => '500 club goals since 2012.',
  },
  {
    id: 'club-300', metric: 'club_goals',
    test: (player) => clubGoals(player) >= 300,
    text: () => '300 club goals since 2012.',
  },
  {
    id: 'international-50', metric: 'international_goals',
    test: (player) => (player.internationalGoals ?? 0) >= 50,
    text: () => 'A 50-goal international.',
  },
  {
    id: 'late-bloomer', metric: 'goals_after_age_30',
    test: (player) => (player.stats?.goals_after_age_30 ?? 0) >= 50,
    text: () => 'A late bloomer.',
  },
  {
    id: 'centurion-world-cup', metric: 'international_caps',
    test: (player) => (player.internationalCaps ?? 0) >= 100 && hasWorldCupGoal(player),
    text: () => 'A centurion with a World Cup goal.',
  },
  {
    id: 'five-leagues', metric: null,
    test: (player) => leagueCount(player) >= 5,
    text: (player) => `A career across ${numberWord(leagueCount(player))} leagues.`,
  },
  {
    id: 'centurion', metric: 'international_caps',
    test: (player) => (player.internationalCaps ?? 0) >= 100,
    text: () => 'A centurion.',
  },
  {
    id: 'world-cup-scorer', metric: 'tournament_goals',
    test: hasWorldCupGoal,
    text: () => 'A World Cup scorer.',
  },
];

/**
 * One true, pool-aware line for the question. The rarest true trait wins:
 * a hook that describes half the quiz is not a hook.
 *
 * `excludeMetrics` keeps the hook from repeating the record that is already
 * on screen.
 */
export function identityHook(subject, pool = [], { excludeMetrics = [] } = {}) {
  if (!subject) return null;
  const players = Array.isArray(pool) && pool.length ? pool : [subject];
  const excluded = new Set(excludeMetrics.filter(Boolean));
  const candidates = HOOKS
    .filter((hook) => !excluded.has(hook.metric) && hook.test(subject))
    .map((hook) => ({
      hook,
      frequency: players.filter((player) => hook.test(player)).length / players.length,
    }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.frequency - b.frequency || HOOKS.indexOf(a.hook) - HOOKS.indexOf(b.hook));
  return candidates[0].hook.text(subject);
}

// ---------------------------------------------------------------------------
// The catalogue.
// ---------------------------------------------------------------------------

export const CLUE_FAMILIES = Object.freeze([
  'career_trail',
  'teammate_trail',
  'record_book',
  'profile',
  'mixed',
]);

export const CLUE_FAMILY_LABELS = Object.freeze({
  career_trail: 'Career trail',
  teammate_trail: 'Teammate trail',
  record_book: 'Record book',
  profile: 'Profile',
  mixed: 'Mixed bag',
});

/**
 * The family's own ladder, in the order it should be revealed.
 *
 * `null` means the family cannot supply a usable ladder; the caller falls
 * back to the mixed ladder. The mixed ladder itself is `buildHints`.
 */
export function familyClues(family, subject, window, registry, { pool, scope, rng } = {}) {
  const stage = stageHint(subject, { window, scope, registry });

  switch (family) {
    case 'career_trail': {
      const clues = [
        stage,
        trailHint(subject),
        recordHints(subject, pool, stage, window)[0] ?? null,
        homeHint(subject),
      ];
      return clues.filter(Boolean);
    }
    case 'teammate_trail': {
      const mates = teammateHints(subject, pool, { rng, limit: 3 });
      if (mates.length < 2) return null;
      const clues = [
        mates[0],
        mates[1],
        trailHint(subject),
        mates[2] ?? null,
        profileHints(subject)[0] ?? homeHint(subject),
      ];
      return clues.filter(Boolean);
    }
    case 'record_book': {
      const records = recordHints(subject, pool, stage, window).slice(0, 3);
      if (records.length < 2) return null;
      const tail = homeHint(subject) ?? profileHints(subject)[0] ?? null;
      return [...records, tail].filter(Boolean);
    }
    case 'profile': {
      const clues = profileHints(subject);
      return clues.length >= 2 ? clues : null;
    }
    default:
      return null;
  }
}

export function buildHints(subject, window, registry, { limit, pool, scope } = {}) {
  const hints = [];

  const stage = stageHint(subject, { window, scope, registry });
  if (stage) hints.push(stage);

  const trail = trailHint(subject);
  if (trail) hints.push(trail);

  const record = recordHint(subject, pool, stage, window);
  if (record) hints.push(record);

  const profile = profileHint(subject);
  if (profile) hints.push(profile);

  const home = homeHint(subject);
  if (home) hints.push(home);

  return hintOrder(hints).slice(0, limit);
}

export function hintRank(hint) {
  return ROLE_RANK[hint.role] ?? 5;
}

export function hintOrder(hints) {
  return [...hints].sort((a, b) => hintRank(a) - hintRank(b));
}
