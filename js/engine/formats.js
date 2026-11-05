/**
 * Football IQ round formats.
 *
 * The four formats share the round shape `composeRound` produces, plus a
 * `reveal` payload that stays secret until the round closes. A builder
 * returns null when the pool cannot supply a valid round; the planner
 * falls back to another format.
 */
import { formatMetric, metricDescriptor } from './stats.js';
import { profileHints } from './hints.js';
import { nameDistractors, buildOptions, withUnit } from './distractors.js';
import { metricValue } from './questions.js';
import { careerTeams } from './career.js';
import { seasonLabel } from '../../lib/seasons.js';
import { pick, shuffle } from './rng.js';

export const IQ_FORMATS = Object.freeze(['club', 'teammate', 'comparison', 'range']);

export const FORMAT_LABELS = Object.freeze({
  club: 'Club in a season',
  teammate: 'Teammate',
  comparison: 'Most in the pool',
  range: 'Stat range',
});

function nationalityOf(player) {
  return player?.nationality ?? player?.citizenship?.[0] ?? null;
}

function playerRef(player) {
  return { id: player.id, name: player.name };
}

function seasonKey(team, season) {
  // The pool's window keys are short seasons ("FC Barcelona 12/13"), not
  // the full labels the prompt uses.
  const start = String(season).slice(-2).padStart(2, '0');
  const end = String(season + 1).slice(-2).padStart(2, '0');
  return `${team.clubName} ${start}/${end}`;
}

function inWindow(season, window) {
  if (!window) return true;
  if (window.kind === 'season') return season === window.seasonStart;
  if (window.kind === 'season_range') {
    return (window.seasonStart == null || season >= window.seasonStart)
      && (window.seasonEnd == null || season <= window.seasonEnd);
  }
  return true;
}

function preferredFirst(entries, window, rng) {
  const shuffled = shuffle(rng, entries);
  const inside = shuffled.filter((entry) => inWindow(entry.season, window));
  return inside.length ? [...inside, ...shuffled.filter((entry) => !inside.includes(entry))] : shuffled;
}

function scheduleFor(clues) {
  return clues.map((_, i) => ({
    stage: i + 1,
    revealAtMs: Math.min(19500, 2000 + i * 4500),
  }));
}

function roundShape({
  format, subject, prompt, context, answer, answerPlayerId, unit = null,
  options, clues, reveal, metric = null, difficulty = 'medium', stages = 4,
}) {
  const ladder = clues.filter(Boolean).slice(0, Math.max(1, stages));
  if (ladder.length < 2) return null;
  return {
    template: format,
    metric,
    family: format,
    clueFamily: null,
    prompt,
    hook: null,
    context: context ?? null,
    subjectId: subject.id,
    subjectName: subject.name,
    answerPlayerId: answerPlayerId ?? subject.id,
    answer,
    unit,
    options,
    clues: ladder,
    revealSchedule: scheduleFor(ladder),
    reveal,
    difficulty,
  };
}

// ---------------------------------------------------------------------------
// Club in a season
// ---------------------------------------------------------------------------

function clubSeasonIndex(pool) {
  const index = new Map();
  const byId = new Map(pool.map((player) => [player.id, player]));
  for (const player of pool) {
    for (const team of player.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const key = `${team.clubId}|${season}`;
        if (!index.has(key)) {
          index.set(key, {
            clubId: team.clubId,
            clubName: team.clubName,
            leagueId: team.leagueId,
            season,
            players: new Set(),
          });
        }
        index.get(key).players.add(player.id);
      }
    }
  }
  return { index, byId };
}

function leagueSeasonIndex(index) {
  const out = new Map();
  for (const entry of index.values()) {
    const key = `${entry.leagueId}|${entry.season}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(entry);
  }
  return out;
}

function clubCandidateEntries(subject, index, byLeagueSeason) {
  const bySeason = new Map();
  for (const team of subject.teams ?? []) {
    for (const season of team.seasons ?? []) {
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push(team);
    }
  }

  const career = careerTeams(subject);
  const entries = [];
  for (const [season, teams] of bySeason) {
    if (teams.length !== 1) continue;
    const team = teams[0];
    const bucket = index.get(`${team.clubId}|${season}`);
    const goals = subject.windows?.[seasonKey(team, season)]?.goals;
    const positiveGoals = typeof goals === 'number' && goals > 0;
    const hasTeammate = (bucket?.players.size ?? 0) > 1;
    const sameLeague = (byLeagueSeason.get(`${team.leagueId}|${season}`) ?? [])
      .filter((other) => other.clubId !== team.clubId);
    const optionNames = [...new Set(sameLeague.map((club) => club.clubName))];
    if (optionNames.length < 3) continue;

    const careerTeam = career.find((other) => other.clubId !== team.clubId
      && (other.seasons ?? []).length > 0
      && sameLeague.some((option) => option.clubId === other.clubId));
    const careerEntry = careerTeam
      ? {
        name: sameLeague.find((option) => option.clubId === careerTeam.clubId).clubName,
        season: Math.min(...careerTeam.seasons),
      }
      : null;
    const facts = (positiveGoals ? 1 : 0) + (hasTeammate ? 1 : 0) + (careerEntry ? 1 : 0);
    if (facts < 2) continue;

    entries.push({
      team,
      season,
      goals: positiveGoals ? goals : null,
      optionNames,
      careerEntry,
    });
  }
  return entries;
}

function leagueName(team, registry) {
  return team.leagueName ?? registry?.leagues?.[team.leagueId] ?? null;
}

export function buildClubRound({ pool, registry, window, rng, difficulty, stages = 4, excludeSubjectIds = new Set() }) {
  const { index, byId } = clubSeasonIndex(pool);
  const byLeagueSeason = leagueSeasonIndex(index);
  const candidates = [];
  for (const subject of pool) {
    if (excludeSubjectIds.has(subject.id)) continue;
    const entries = clubCandidateEntries(subject, index, byLeagueSeason);
    if (entries.length) candidates.push({ subject, entries });
  }
  if (!candidates.length) return null;

  const chosen = pick(rng, candidates);
  const entry = preferredFirst(chosen.entries, window, rng)[0];
  const { team, season, goals, optionNames, careerEntry } = entry;
  const league = leagueName(team, registry);
  const bucket = index.get(`${team.clubId}|${season}`);
  const teammates = [...(bucket?.players ?? [])]
    .filter((id) => id !== chosen.subject.id)
    .map((id) => byId.get(id))
    .filter(Boolean);
  const teammate = teammates.length ? pick(rng, teammates) : null;

  const clues = [
    goals
      ? { id: 'club-goals', label: 'The season', value: `They scored ${goals} ${goals === 1 ? 'goal' : 'goals'} in ${seasonLabel(season)}.`, iconKey: 'honors' }
      : teammate
        ? { id: 'club-squad', label: 'The squad', value: `${teammate.name} was in the squad that season.`, iconKey: 'team' }
        : null,
    goals && teammate
      ? { id: 'club-squad', label: 'The squad', value: `${teammate.name} was in the squad that season.`, iconKey: 'team' }
      : null,
    careerEntry
      ? { id: 'club-other', label: 'The career', value: `Also played for ${careerEntry.name} in ${seasonLabel(careerEntry.season)}.`, iconKey: 'path' }
      : null,
    ...profileHints(chosen.subject).slice(0, 1),
  ];

  const distractors = careerEntry
    ? [careerEntry.name, ...shuffle(rng, optionNames.filter((name) => name !== careerEntry.name))]
    : shuffle(rng, optionNames);
  const options = buildOptions({
    answer: team.clubName,
    distractors,
    rng,
  });

  return roundShape({
    format: 'club',
    subject: chosen.subject,
    prompt: `Which club did ${chosen.subject.name} play for in ${seasonLabel(season)}?`,
    context: window?.label ?? null,
    answer: team.clubName,
    unit: null,
    options,
    clues,
    difficulty,
    stages,
    reveal: {
      format: 'club',
      player: playerRef(chosen.subject),
      season: seasonLabel(season),
      club: team.clubName,
      league,
      goals: goals ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Teammate
// ---------------------------------------------------------------------------

function otherClubFact(player, excludeClubId) {
  for (const team of careerTeams(player)) {
    if (team.clubId === excludeClubId) continue;
    const season = Math.min(...(team.seasons ?? []));
    if (!Number.isFinite(season)) continue;
    return `Also played for ${team.clubName} in ${seasonLabel(season)}.`;
  }
  return null;
}

export function buildTeammateRound({ pool, registry, window, rng, difficulty, stages = 4, excludeSubjectIds = new Set() }) {
  const { index, byId } = clubSeasonIndex(pool);
  const candidates = [];
  for (const subject of pool) {
    if (excludeSubjectIds.has(subject.id)) continue;
    const entries = [];
    for (const team of subject.teams ?? []) {
      for (const season of team.seasons ?? []) {
        const bucket = index.get(`${team.clubId}|${season}`);
        if (bucket && bucket.players.size >= 2) {
          entries.push({ team, season, bucket });
        }
      }
    }
    if (entries.length) candidates.push({ subject, entries });
  }
  if (!candidates.length) return null;

  const chosen = pick(rng, candidates);
  const entry = preferredFirst(chosen.entries, window, rng)[0];
  const { team, season, bucket } = entry;
  const teammates = [...bucket.players]
    .filter((id) => id !== chosen.subject.id)
    .map((id) => byId.get(id))
    .filter(Boolean);
  if (!teammates.length) return null;

  // Prefer a teammate with something to say about them.
  const described = teammates.filter((p) => profileHints(p).length >= 1);
  const teammate = pick(rng, described.length ? described : teammates);

  const profile = profileHints(teammate);
  const clues = [
    profile.find((h) => h.role === 'role') ?? null,
    profile.find((h) => h.role === 'home') ?? null,
    otherClubFact(teammate, team.clubId)
      ? { id: 'mate-other', label: 'The career', value: otherClubFact(teammate, team.clubId), iconKey: 'path' }
      : null,
    profile.find((h) => h.role === 'born') ?? profile.find((h) => h.role === 'height') ?? null,
  ].filter(Boolean);
  if (clues.length < 2) return null;

  const sameSeason = shuffle(rng, teammates.filter((p) => p.id !== teammate.id).map((p) => p.name));
  const fallback = nameDistractors({
    pool,
    subject: chosen.subject,
    rng,
    count: 3,
    excludeIds: [teammate.id],
  }).map((p) => p.name);

  const options = buildOptions({
    answer: teammate.name,
    distractors: [...sameSeason, ...fallback],
    rng,
  });

  return roundShape({
    format: 'teammate',
    subject: chosen.subject,
    prompt: `Who was a teammate of ${chosen.subject.name} at ${team.clubName} in ${seasonLabel(season)}?`,
    context: window?.label ?? null,
    answer: teammate.name,
    answerPlayerId: teammate.id,
    options,
    clues,
    difficulty,
    stages,
    reveal: {
      format: 'teammate',
      player: playerRef(chosen.subject),
      teammate: playerRef(teammate),
      club: team.clubName,
      season: seasonLabel(season),
      position: teammate.position ?? null,
      nationality: nationalityOf(teammate),
    },
  });
}

// ---------------------------------------------------------------------------
// Most in the pool
// ---------------------------------------------------------------------------

const COMPARISON_METRICS = Object.freeze([
  { id: 'club_goals', label: 'club goals', unit: 'goals', value: (p) => p.stats?.club_goals },
  { id: 'international_goals', label: 'international goals', unit: 'goals', value: (p) => p.internationalGoals },
  { id: 'international_caps', label: 'international caps', unit: 'caps', value: (p) => p.internationalCaps },
  { id: 'highest_market_value_eur', label: 'peak market value', unit: null, value: (p) => p.highestMarketValueEur },
  { id: 'goals_after_age_30', label: 'goals after turning 30', unit: 'goals', value: (p) => p.stats?.goals_after_age_30 },
  { id: 'club_appearances', label: 'club appearances', unit: 'apps', value: (p) => p.stats?.club_appearances },
]);

function distinctTop(metric, pool) {
  const rows = pool
    .map((player) => ({ player, value: metric.value(player) }))
    .filter((row) => row.value !== undefined && row.value !== null && row.value > 0)
    .sort((a, b) => b.value - a.value);

  const distinct = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.value)) continue;
    seen.add(row.value);
    distinct.push(row);
  }
  if (distinct.length < 4) return null;
  // A tie at the top makes "the most" ambiguous.
  if (rows.filter((row) => row.value === distinct[0].value).length > 1) return null;
  return distinct.slice(0, 4);
}

export function buildComparisonRound({ pool, rng, difficulty, stages = 4, excludeSubjectIds = new Set() }) {
  const metrics = shuffle(rng, [...COMPARISON_METRICS]);
  for (const metric of metrics) {
    const rows = distinctTop(metric, pool);
    if (!rows) continue;
    const answer = rows[0];
    if (excludeSubjectIds.has(answer.player.id)) continue;

    const [first, second, third, fourth] = rows.map((row) => row.value);
    const bounds = [fourth, third, second];
    const clues = bounds.map((bound, i) => ({
      id: `comparison-${metric.id}-${i}`,
      label: i === 0 ? 'The field' : i === 1 ? 'The shortlist' : 'The leader',
      value: `The answer has more than ${withUnit(bound, metric.unit)}.`,
      iconKey: 'honors',
    }));
    const profile = profileHints(answer.player)[0];
    if (profile) clues.push(profile);

    const options = buildOptions({
      answer: answer.player.name,
      distractors: rows.slice(1).map((row) => row.player.name),
      rng,
    });

    return roundShape({
      format: 'comparison',
      subject: answer.player,
      prompt: `Who has the most ${metric.label}?`,
      context: null,
      answer: answer.player.name,
      answerPlayerId: answer.player.id,
      options,
      clues,
      difficulty,
      stages,
      metric: metric.id,
      reveal: {
        format: 'comparison',
        metric: metric.id,
        metricLabel: metricDescriptor(metric.id)?.label ?? metric.label,
        unit: metric.unit,
        values: rows.map((row) => ({ player: playerRef(row.player), value: row.value })),
      },
    });
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stat range
// ---------------------------------------------------------------------------

const GOAL_BUCKETS = Object.freeze([
  { label: '0-9', start: 0, end: 9 },
  { label: '10-24', start: 10, end: 24 },
  { label: '25-49', start: 25, end: 49 },
  { label: '50+', start: 50, end: null },
]);

const CAP_BUCKETS = Object.freeze([
  { label: '0-24', start: 0, end: 24 },
  { label: '25-49', start: 25, end: 49 },
  { label: '50-99', start: 50, end: 99 },
  { label: '100+', start: 100, end: null },
]);

const VALUE_BUCKETS = Object.freeze([
  { label: '<€10M', start: 0, end: 9_999_999, market: true },
  { label: '€10-29M', start: 10_000_000, end: 29_999_999, market: true },
  { label: '€30-59M', start: 30_000_000, end: 59_999_999, market: true },
  { label: '€60M+', start: 60_000_000, end: null, market: true },
]);

const APPEARANCE_BUCKETS = Object.freeze([
  { label: '0-49', start: 0, end: 49 },
  { label: '50-149', start: 50, end: 149 },
  { label: '150-299', start: 150, end: 299 },
  { label: '300+', start: 300, end: null },
]);

const RANGE_METRICS = Object.freeze({
  club_goals: { unit: 'goals', buckets: GOAL_BUCKETS, label: 'goals' },
  tournament_goals: { unit: 'goals', buckets: GOAL_BUCKETS, label: 'tournament goals' },
  international_goals: { unit: 'goals', buckets: GOAL_BUCKETS, label: 'international goals' },
  goals_after_age_30: { unit: 'goals', buckets: GOAL_BUCKETS, label: 'goals after turning 30' },
  international_caps: { unit: 'caps', buckets: CAP_BUCKETS, label: 'international caps' },
  highest_market_value_eur: { unit: null, buckets: VALUE_BUCKETS, label: 'peak market value' },
  club_appearances: { unit: 'apps', buckets: APPEARANCE_BUCKETS, label: 'club appearances' },
});

function bucketFor(buckets, value) {
  return buckets.find((bucket) => value >= bucket.start
    && (bucket.end === null || value <= bucket.end)) ?? null;
}

function rangeMetricsFor(window) {
  if (window?.kind === 'tournament') return ['tournament_goals'];
  if (window?.kind === 'season') return ['club_goals'];
  return ['international_caps', 'international_goals', 'goals_after_age_30', 'highest_market_value_eur', 'club_appearances', 'club_goals'];
}

function boundText(metric, value, unit, direction) {
  if (metric === 'highest_market_value_eur') {
    return direction === 'over'
      ? `More than ${formatMetric(metric, value)}.`
      : `Less than ${formatMetric(metric, value)}.`;
  }
  const noun = withUnit(value, unit);
  return direction === 'over'
    ? `More than ${noun}.`
    : `Fewer than ${noun}.`;
}

function rangeValue(player, metric, window, registry) {
  // The tournament window's goals are not club goals; keep the same
  // sharp distinction the stat rounds make.
  if (metric === 'tournament_goals') {
    return window?.id ? player.windows?.[window.id]?.goals : undefined;
  }
  return metricValue(player, metric, window);
}

function rangePrompt(subject, metric, window) {
  if (metric === 'tournament_goals') {
    return `How many goals did ${subject.name} score at the ${window?.label ?? 'tournament'}?`;
  }
  if (metric === 'club_goals' && window?.kind === 'season') {
    return `How many goals did ${subject.name} score for ${window.teamName ?? 'that club'} in ${window.label ?? 'that season'}?`;
  }
  if (metric === 'international_caps') return `How many international caps did ${subject.name} have?`;
  if (metric === 'international_goals') return `How many international goals did ${subject.name} score?`;
  if (metric === 'goals_after_age_30') return `How many goals did ${subject.name} score after turning 30?`;
  if (metric === 'highest_market_value_eur') return `What was ${subject.name}'s highest market value?`;
  if (metric === 'club_appearances') return `How many club appearances did ${subject.name} make since 2012?`;
  return `How many club goals did ${subject.name} score since 2012?`;
}

export function buildRangeRound({ pool, window, registry, rng, difficulty, stages = 4, excludeSubjectIds = new Set() }) {
  const metricIds = shuffle(rng, rangeMetricsFor(window));
  for (const metricId of metricIds) {
    const descriptor = RANGE_METRICS[metricId];
    if (!descriptor) continue;

    const candidates = [];
    const allValues = [];
    for (const player of pool) {
      const value = rangeValue(player, metricId, window, registry);
      if (value === undefined || value === null || value <= 0) continue;
      allValues.push(value);
      if (excludeSubjectIds.has(player.id)) continue;
      const bucket = bucketFor(descriptor.buckets, value);
      if (bucket) candidates.push({ player, value, bucket });
    }
    if (!candidates.length) continue;

    const chosen = pick(rng, candidates);
    const { bucket } = chosen;
    const lower = bucket.start > 0
      ? { id: 'range-over', label: 'The floor', value: boundText(metricId, bucket.start - 1, descriptor.unit, 'over'), iconKey: 'honors' }
      : null;
    const upper = bucket.end !== null
      ? { id: 'range-under', label: 'The ceiling', value: boundText(metricId, bucket.end + 1, descriptor.unit, 'under'), iconKey: 'honors' }
      : null;

    const less = allValues.filter((value) => value < chosen.value).length;
    const share = allValues.length > 1 ? less / allValues.length : 0;
    const percentile = allValues.length > 1
      ? {
        id: 'range-pool',
        label: 'The pool',
        value: share >= 0.75
          ? 'Higher than three quarters of this pool.'
          : share >= 0.5
            ? 'Higher than half of this pool.'
            : share >= 0.25
              ? 'Higher than a quarter of this pool.'
              : 'Lower than most of this pool.',
        iconKey: 'value',
      }
      : null;
    const profile = profileHints(chosen.player)[0] ?? null;

    const clues = [lower, upper, percentile, profile].filter(Boolean);
    if (clues.length < 2) continue;

    const distractors = descriptor.buckets
      .filter((other) => other.label !== bucket.label)
      .map((other) => other.label);

    const options = buildOptions({
      answer: bucket.label,
      distractors,
      rng,
      unit: descriptor.unit,
    });

    return roundShape({
      format: 'range',
      subject: chosen.player,
      prompt: rangePrompt(chosen.player, metricId, window),
      context: window?.label ?? null,
      answer: bucket.label,
      unit: descriptor.unit,
      options,
      clues,
      difficulty,
      stages,
      metric: metricId,
      reveal: {
        format: 'range',
        player: playerRef(chosen.player),
        metric: metricId,
        metricLabel: descriptor.label,
        unit: descriptor.unit,
        value: chosen.value,
        valueText: formatMetric(metricId, chosen.value, window),
        range: bucket.label,
        rangeText: descriptor.unit ? withUnit(bucket.label, descriptor.unit) : bucket.label,
        window: window?.label ?? null,
      },
    });
  }
  return null;
}

export function composeFormatRound({ format, ...args }) {
  switch (format) {
    case 'club': return buildClubRound(args);
    case 'teammate': return buildTeammateRound(args);
    case 'comparison': return buildComparisonRound(args);
    case 'range': return buildRangeRound(args);
    default: return null;
  }
}
