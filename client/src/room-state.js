/**
 * The pure parts of the room state.
 *
 * Kept apart from room.js so they can be tested without a browser, a
 * network or the Supabase SDK.
 */

/** Fold the server's current-round payload into the room state. */
export function applyRound(state, payload) {
  const next = payload?.round ?? null;

  // A new round means the last answer is spent: the player has to be
  // able to answer again, and the reveal has to ask about the round that
  // just closed, not the one that just opened.
  if (next && state.round && next.round_number !== state.round.round_number) {
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = null;
    state.fetchingResult = false;
  }

  state.round = next;
  state.currentRound = payload?.current_round ?? 0;
  state.totalRounds = payload?.total_rounds ?? state.totalRounds ?? 10;
  state.status = payload?.status ?? state.status ?? 'lobby';
  state.answeredCount = payload?.answered_count ?? 0;
  return state;
}

/** Fold the member list in, in join order. */
export function applyMembers(state, members) {
  state.members = [...(members ?? [])].sort((a, b) => (a.joined_seq ?? 0) - (b.joined_seq ?? 0));
  return state;
}

/** Fold the leaderboard in, ranked the way the game ranks it. */
export function applyLeaderboard(state, board) {
  state.leaderboard = [...(board ?? [])].sort((a, b) => {
    if ((b.total_score ?? 0) !== (a.total_score ?? 0)) return (b.total_score ?? 0) - (a.total_score ?? 0);
    if ((b.correct_count ?? 0) !== (a.correct_count ?? 0)) return (b.correct_count ?? 0) - (a.correct_count ?? 0);
    if ((a.total_response_ms ?? 0) !== (b.total_response_ms ?? 0)) return (a.total_response_ms ?? 0) - (b.total_response_ms ?? 0);
    return (a.joined_seq ?? 0) - (b.joined_seq ?? 0);
  });
  return state;
}

/**
 * What to call a player in the leaderboard.
 *
 * Two players may pick the same name, so the second one gets a number.
 */
export function labelFor(state, userId) {
  const name = (state.members ?? []).find((m) => m.user_id === userId)?.display_name
    ?? (state.leaderboard ?? []).find((m) => m.user_id === userId)?.display_name
    ?? 'Player';
  const sameName = [...(state.members ?? []), ...(state.leaderboard ?? [])]
    .filter((m) => m.display_name === name)
    .sort((a, b) => (a.joined_seq ?? 0) - (b.joined_seq ?? 0));
  if (sameName.length < 2) return name;
  const index = sameName.findIndex((m) => m.user_id === userId);
  // The first player to take a name keeps it plain: "Alex", "Alex #2".
  if (index <= 0) return name;
  return `${name} #${index + 1}`;
}
