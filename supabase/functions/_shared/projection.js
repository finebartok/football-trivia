/**
 * Turns a composed round into the two shapes the database stores.
 *
 * The client row is what a room member may read. It must not contain the
 * answer, and it must not contain a flag saying which option is right -
 * the row is readable, so anything in it is public to the room.
 *
 * The secret is the answer key. It goes into round_secrets, which no
 * client can read.
 *
 * Pure: no imports, so it runs in Deno and in Node and can be tested by
 * both.
 */

export function projectRound(round, roundNumber) {
  return {
    client: {
      round_number: roundNumber,
      template: round.template,
      prompt: round.hook ? `${round.prompt}\n${round.hook}` : round.prompt,
      context: round.context ?? null,
      clues: round.clues.map((c) => ({
        id: c.id,
        label: c.label,
        value: c.value,
        iconKey: c.iconKey ?? null,
      })),
      options: round.options.map((o) => ({
        id: o.id,
        label: o.label,
        value: o.value,
      })),
      reveal_schedule: round.revealSchedule.map((s) => ({
        stage: s.stage,
        revealAtMs: s.revealAtMs,
      })),
    },
    secret: {
      answer_value: String(round.answer),
      target_player_id: round.subjectId ?? null,
      unit: round.unit ?? null,
    },
  };
}
