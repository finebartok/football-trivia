/**
 * A player's club path, oldest first.
 *
 * The pool's `teams` array is not guaranteed to be chronological: some
 * sources order it by club id, which turns a career into a random walk.
 * A path is only useful as a path, so the order is derived from the
 * seasons the data actually carries.
 */

function firstSeason(team) {
  return team?.seasons?.length ? Math.min(...team.seasons) : Infinity;
}

function lastSeason(team) {
  return team?.seasons?.length ? Math.max(...team.seasons) : -Infinity;
}

function compareTeams(a, b) {
  const aFirst = firstSeason(a);
  const bFirst = firstSeason(b);
  if (aFirst !== bFirst) {
    if (aFirst === Infinity) return 1;
    if (bFirst === Infinity) return -1;
    return aFirst - bFirst;
  }
  const aLast = lastSeason(a);
  const bLast = lastSeason(b);
  if (aLast !== bLast) {
    if (aLast === -Infinity) return 1;
    if (bLast === -Infinity) return -1;
    return aLast - bLast;
  }
  return String(a.clubName).localeCompare(String(b.clubName));
}

/** The clubs, oldest first. Missing seasons sort last, then by name. */
export function careerTeams(player) {
  return [...(player?.teams ?? [])]
    .filter((team) => team?.clubName)
    .sort(compareTeams);
}

export function careerClubs(player) {
  return careerTeams(player).map((team) => team.clubName);
}
