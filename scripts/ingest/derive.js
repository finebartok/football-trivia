// Derives the club path from raw evidence. A transfer says a player joined a
// club in a season; an appearance says a player was registered for a club in a
// season, which is the stronger claim. Pure: takes arrays, returns arrays.
import { seasonLabel } from '../../lib/seasons.js';
import path from 'node:path';
import { readCsvGz } from './lib/csv.js';

const EVIDENCE_RANK = { override: 1, wikidata: 2, transfer: 3, appearance: 4 };

export function deriveStints({ transfers = [], appearances = [], clubsById = {} }) {
  /** @type {Map<string, {playerSourceKey,clubId,seasons:Set<number>,evidence:string}>} */
  const byPlayerClub = new Map();

  const touch = (playerSourceKey, clubId, season, evidence) => {
    const key = `${playerSourceKey}|${clubId}`;
    let e = byPlayerClub.get(key);
    if (!e) {
      e = { playerSourceKey, clubId, seasons: new Set(), evidence };
      byPlayerClub.set(key, e);
    }
    e.seasons.add(season);
    if (EVIDENCE_RANK[evidence] > EVIDENCE_RANK[e.evidence]) e.evidence = evidence;
  };

  for (const t of transfers) {
    const cid = t.toClubId ? Number(t.toClubId) : null;
    if (cid && clubsById[cid]) touch(t.playerSourceKey, cid, t.season, 'transfer');
    const fid = t.fromClubId ? Number(t.fromClubId) : null;
    if (fid && clubsById[fid]) touch(t.playerSourceKey, fid, t.season, 'transfer');
  }
  for (const a of appearances) {
    const cid = Number(a.clubId);
    if (cid && clubsById[cid]) touch(a.playerSourceKey, cid, a.season, 'appearance');
  }

  const stints = [];
  const seasons = [];
  for (const e of byPlayerClub.values()) {
    const sorted = [...e.seasons].sort((x, y) => x - y);
    let runStart = sorted[0];
    let prev = sorted[0];
    const runs = [];
    for (const s of sorted.slice(1)) {
      if (s === prev + 1) { prev = s; continue; }
      runs.push([runStart, prev]);
      runStart = s; prev = s;
    }
    runs.push([runStart, prev]);

    for (const [start, end] of runs) {
      stints.push({
        playerSourceKey: e.playerSourceKey,
        clubId: e.clubId,
        seasonStart: start,
        seasonEnd: end,
        evidence: e.evidence,
      });
    }
    for (const s of sorted) {
      seasons.push({
        playerSourceKey: e.playerSourceKey,
        season: s,
        clubId: e.clubId,
        leagueId: clubsById[e.clubId]?.leagueId ?? null,
      });
    }
  }
  return { stints, seasons };
}

// Windows are the named, bounded slices of a career that every era scope and
// every windowed question is asked through. A window is never invented: it is
// built only from a goal event, an appearance, or a club-season the data holds.
// A missing value stays null - this function never fabricates one.
const AGE_BAND = 30;
// Club coverage in the dump starts 2012/13, so the age band is the 2012+ window
// the spec's figures are stated against.
const AGE_WINDOW_START = 2012;
export function deriveWindows({ goals = [], appearances = [], games = [], clubsById = {}, competitionsById = {}, dobById = {} }) {
  /** @type {Map<string, Window>} */
  const windows = new Map();
  /** @type {Map<string, {playerSourceKey, windowId, metric, value, exact}>} */
  const stats = new Map();

  const addWindow = (w) => {
    if (!windows.has(w.id)) windows.set(w.id, w);
    return w.id;
  };

  const bump = (playerSourceKey, windowId, metric, delta, exact = true) => {
    const key = `${playerSourceKey}|${windowId}|${metric}`;
    const prev = stats.get(key);
    stats.set(key, {
      playerSourceKey, windowId, metric,
      // ponytail: only used for additive counts (goals, apps) where 0 is the true sum of an empty set.
      // a missing metric must never be summed into one.
      value: (prev?.value ?? 0) + delta,
      exact,
    });
  };

  // The club-season window is the meeting place of the two evidence sources:
  // a goal and an appearance for the same club-season land in the same window.
  const seasonWindow = (clubId, season) => {
    const club = clubsById[clubId];
    if (!club || !season) return null;
    return addWindow({
      id: `${clubId}-${season}`, kind: 'season',
      label: `${club.name} ${seasonLabel(season)}`,
      detail: 'the season',
      seasonStart: season, seasonEnd: season,
      tournamentId: null, clubId, teamName: club.name,
      ageFrom: null, ageTo: null,
    });
  };

  for (const g of goals) {
    const seasonId = seasonWindow(g.clubId, g.season);
    if (seasonId) bump(g.playerSourceKey, seasonId, 'goals', 1);

    // A tournament window needs a national-team competition, not a league, and
    // a year: the Finals season key is the qualification start, so the window's
    // year comes from the game date, not the season.
    if (g.competitionId && g.year) {
      const comp = competitionsById[g.competitionId];
      if (comp && comp.type === 'national_team_competition') {
        const id = tournamentWindowId(g.competitionId, g.year);
        addWindow({
          id, kind: 'tournament',
          label: `${g.year} ${comp.name.replace(/-/g, ' ')}`,
          detail: 'the tournament',
          seasonStart: g.year, seasonEnd: g.year,
          tournamentId: id, clubId: null, teamName: null,
          ageFrom: null, ageTo: null,
        });
        bump(g.playerSourceKey, id, 'goals', 1);
      }
    }
  }

  for (const a of appearances) {
    const id = seasonWindow(a.clubId, a.season);
    if (id) bump(a.playerSourceKey, id, 'appearances', 1);
  }

  // The age band is the one window backed by a date of birth. Age at an
  // appearance is the calendar-year difference (appearanceYear - birthYear),
  // with no birthday adjustment: it is the rule the spec's measured figures
  // (1,085 >= 10 / 285 >= 30 / 111 >= 50 / 23 >= 100 aged 30+) were taken with,
  // and it reproduces them. Club coverage starts 2012/13, so an appearance
  // before 2012 is outside this window and is not counted. No DOB means no age:
  // the window and metric are simply absent for that player, never 0.
  for (const a of appearances) {
    const dob = dobById[a.playerSourceKey];
    const year = a.year;
    if (!dob || !year || year < AGE_WINDOW_START) continue;
    const birthYear = Number.parseInt(String(dob).slice(0, 4), 10);
    if (Number.isNaN(birthYear)) continue;
    if (year - birthYear < AGE_BAND) continue;
    if (!(a.goals > 0)) continue;
    const id = addWindow({
      id: `age-${AGE_BAND}`, kind: 'age_band',
      label: `aged ${AGE_BAND}+`, detail: `goals scored from ${AGE_WINDOW_START} on`,
      seasonStart: AGE_WINDOW_START, seasonEnd: null,
      tournamentId: null, clubId: null, teamName: null,
      ageFrom: AGE_BAND, ageTo: null,
    });
    bump(a.playerSourceKey, id, `goals_after_age_${AGE_BAND}`, a.goals, false);
  }

  // The career window is the union of every window this player appears in, so
  // it is only created for a player the data actually describes.
  const byPlayer = new Map();
  for (const s of stats.values()) {
    if (!byPlayer.has(s.playerSourceKey)) byPlayer.set(s.playerSourceKey, []);
    byPlayer.get(s.playerSourceKey).push(s);
  }
  for (const [playerSourceKey, own] of byPlayer) {
    let goalsTotal = 0;
    let appsTotal = 0;
    let minSeason = null;
    const sinceCounts = new Map();
    for (const s of own) {
      const w = windows.get(s.windowId);
      if (!w) continue;
      if (s.metric === 'goals') {
        goalsTotal += s.value;
        if (minSeason === null || (w.seasonStart !== null && w.seasonStart < minSeason)) minSeason = w.seasonStart;
        if (w.seasonStart !== null) sinceCounts.set(w.seasonStart, (sinceCounts.get(w.seasonStart) ?? 0) + s.value);
      } else if (s.metric === 'appearances') {
        appsTotal += s.value;
      }
    }
    addWindow({
      id: 'career', kind: 'career',
      label: 'his whole career', detail: 'the career',
      seasonStart: minSeason, seasonEnd: null,
      tournamentId: null, clubId: null, teamName: null,
      ageFrom: null, ageTo: null,
    });
    if (goalsTotal) bump(playerSourceKey, 'career', 'goals', goalsTotal);
    if (appsTotal) bump(playerSourceKey, 'career', 'appearances', appsTotal);
    // A since-window is cumulative: 'goals since 2014' sums every later season.
    for (const start of sinceCounts.keys()) {
      if (start === minSeason) continue; // the true career total, not a since-metric
      let total = 0;
      for (const [s, v] of sinceCounts) if (s >= start) total += v;
      const id = addWindow({
        id: `since-${start}`, kind: 'season_range',
        label: `since ${seasonLabel(start)}`, detail: `from ${start} on`,
        seasonStart: start, seasonEnd: null,
        tournamentId: null, clubId: null, teamName: null,
        ageFrom: null, ageTo: null,
      });
      bump(playerSourceKey, id, `goals_since_${start}`, total);
    }
  }

  const windowStats = [...stats.values()];
  return { windows: [...windows.values()], windowStats };
}

function tournamentWindowId(competitionId, year) {
  if (competitionId === 'FIWC') return `wc-${year}`;
  if (competitionId === 'EURO') return `euro-${year}`;
  if (competitionId === 'COPA') return `copa-${year}`;
  if (competitionId === 'AFCN') return `afcn-${year}`;
  if (competitionId === 'AFAC') return `afac-${year}`;
  return `${competitionId.toLowerCase()}-${year}`;
}

// Reads the staged snapshots and prints the derived all-competition club-season
// goal totals for the top scorers, to check them against the real record. The
// games table is small enough to map; the 1.27M-row event stream is never held.
async function report({ rawDir }) {
  const gamesById = new Map();
  for await (const row of readCsvGz(path.join(rawDir, 'games.csv.gz'))) {
    gamesById.set(row.game_id, row);
  }

  const clubsById = {};
  for await (const row of readCsvGz(path.join(rawDir, 'clubs.csv.gz'))) {
    clubsById[Number(row.club_id)] = { id: Number(row.club_id), name: row.name, leagueId: row.domestic_competition_id };
  }

  const competitionsById = {};
  for await (const row of readCsvGz(path.join(rawDir, 'competitions.csv.gz'))) {
    competitionsById[row.competition_id] = { id: row.competition_id, name: row.name, type: row.type };
  }

  const dobById = {};
  for await (const row of readCsvGz(path.join(rawDir, 'players.csv.gz'))) {
    if (row.date_of_birth) dobById[row.player_id] = row.date_of_birth;
  }

  const goals = [];
  for await (const ev of readCsvGz(path.join(rawDir, 'game_events.csv.gz'))) {
    if (ev.type !== 'Goals') continue;
    const game = gamesById.get(ev.game_id);
    if (!game) continue;
    goals.push({
      playerSourceKey: ev.player_id,
      clubId: Number(ev.club_id),
      competitionId: game.competition_id,
      season: Number.parseInt(game.season, 10),
      year: Number.parseInt((game.date || '').slice(0, 4), 10),
    });
  }

  const appearances = [];
  for await (const row of readCsvGz(path.join(rawDir, 'appearances.csv.gz'))) {
    const year = Number.parseInt((row.date || '').slice(0, 4), 10);
    if (!year) continue;
    appearances.push({
      playerSourceKey: row.player_id,
      clubId: Number(row.player_club_id),
      season: year,
      year,
      goals: Number.parseInt(row.goals, 10) || 0,
    });
  }

  const { windowStats } = deriveWindows({ goals, appearances, clubsById, competitionsById, dobById });
  const top = windowStats
    .filter(s => s.metric === 'goals')
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
  for (const s of top) console.log(`${s.value}\t${s.windowId}\tplayer ${s.playerSourceKey}`);
  console.log(`goal events: ${goals.length}`);

  const aged = windowStats.filter(s => s.metric === 'goals_after_age_30').map(s => s.value);
  const at = (n) => aged.filter(v => v >= n).length;
  console.log(`goals_after_age_30: >=10 ${at(10)}  >=30 ${at(30)}  >=50 ${at(50)}  >=100 ${at(100)}  max ${Math.max(0, ...aged)}`);
}

if (import.meta.url.endsWith(path.basename(process.argv[1] ?? ''))) {
  await report({ rawDir: process.env.RAW_DIR ?? 'data/raw' });
}
