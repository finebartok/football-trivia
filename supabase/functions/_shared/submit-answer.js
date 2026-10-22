/**
 * Answer a question.
 *
 * The score is computed here, from the server's own clock. A client that
 * claims to have answered at stage 1 gets the stage the server says they
 * answered at, and a client that sends the winning answer twice does not
 * get two answers.
 */
import { answerRound, scoreRound } from './vendor/js/engine/index.js';
import { makeClients } from '../_shared/supabase.js';
import { json } from './pool-count.js';

export async function handleSubmitAnswer(req, { createClient, env }) {
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const caller = makeClients({ createClient, env }).callerClient(req);
    const { data: authData, error: authError } = await caller.auth.getUser(auth.replace('Bearer ', ''));
    if (authError || !authData?.user) {
      return json({ error: 'not signed in' }, 401);
    }
    const userId = authData.user.id;

    const body = await req.json().catch(() => ({}));
    const roomId = body.room_id;
    const roundNumber = body.round_number;
    const guessed = body.guessed_answer;
    if (!roomId || !roundNumber) {
      return json({ error: 'room_id and round_number are required' }, 400);
    }

    const admin = makeClients({ createClient, env }).serviceClient();

    const { data: membership } = await admin
      .from('room_memberships')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership) {
      return json({ error: 'not a member of that room' }, 403);
    }

    const { data: round } = await admin
      .from('rounds')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', roundNumber)
      .maybeSingle();
    if (!round) {
      return json({ error: 'no such round' }, 404);
    }

    const { data: secret } = await admin
      .from('round_secrets')
      .select('*')
      .eq('round_id', round.id)
      .maybeSingle();
    if (!secret) {
      return json({ error: 'no answer key for that round' }, 500);
    }

    const receivedAt = new Date();

    // The round is open if it has not been closed and its deadline has
    // not passed. The server's clock decides.
    if (round.closed_at || receivedAt > new Date(round.deadline_at)) {
      return json({ error: 'too late - that round is over' }, 409);
    }

    // A retry returns the first answer rather than writing a second row.
    const { data: existing } = await admin
      .from('answers')
      .select('*')
      .eq('round_id', round.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) {
      return json({
        correct: existing.is_correct,
        points: existing.points_earned,
        stage: existing.stage_locked,
        already: true,
      });
    }

    // The stage the server says the player answered at: the number of
    // reveals that had happened by the time the answer arrived.
    const schedule = round.reveal_schedule ?? [];
    const elapsed = Math.max(0, receivedAt.getTime() - new Date(round.started_at).getTime());
    const stage = Math.max(1, schedule.filter((s) => elapsed >= (s.revealAtMs ?? 0)).length);

    // The engine decides whether the answer is right and what it is worth.
    const verdict = answerRound(
      { template: round.template, answer: secret.answer_value },
      { answer: guessed, stage, elapsedMs: elapsed },
    );
    const score = scoreRound({ correct: verdict.correct, stage, elapsedMs: elapsed });

    const { error: insertError } = await admin.from('answers').insert({
      room_id: roomId,
      round_id: round.id,
      user_id: userId,
      guessed_answer: String(guessed ?? ''),
      is_correct: verdict.correct,
      stage_locked: stage,
      response_time_ms: elapsed,
      points_earned: score.points,
      received_at: receivedAt.toISOString(),
    });
    if (insertError) {
      // Two taps at once: one answer was written, and the other one is
      // told what it was.
      if (insertError.code === '23505') {
        const { data: theirs } = await admin
          .from('answers')
          .select('*')
          .eq('round_id', round.id)
          .eq('user_id', userId)
          .maybeSingle();
        if (theirs) {
          return json({
            correct: theirs.is_correct,
            points: theirs.points_earned,
            stage: theirs.stage_locked,
            already: true,
          });
        }
      }
      throw insertError;
    }

    return json({ correct: verdict.correct, points: score.points, stage });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
