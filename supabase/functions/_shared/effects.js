/**
 * Whether this player is copying somebody in this round.
 *
 * Fail closed: if the check cannot run, assume a steal exists. Letting the
 * player answer would score a round they are not playing, and the answer
 * would be theirs, not the target's.
 */
export async function hasSteal(admin, roundId, userId) {
  const { data, error } = await admin
    .from('room_effects')
    .select('id')
    .eq('round_id', roundId)
    .eq('actor_id', userId)
    .eq('kind', 'steal')
    .maybeSingle();
  if (error) return true;
  return Boolean(data);
}
