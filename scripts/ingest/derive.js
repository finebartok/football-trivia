// Derives the club path from raw evidence. A transfer says a player joined a
// club in a season; an appearance says a player was registered for a club in a
// season, which is the stronger claim. Pure: takes arrays, returns arrays.
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
