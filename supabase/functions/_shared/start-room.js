/**
 * Start the game.
 *
 * The plan is generated here, on the server, and never leaves it. The
 * client gets the first round's clues and options and nothing else.
 */
import { planQuiz, scopePool } from '../../../js/engine/index.js';
import { MIN_POOL } from '../../../js/engine/planner.js';
import { presetById } from '../../../js/presets.js';
import { validateScope } from '../../../lib/scope.js';
import { makeClients } from '../_shared/supabase.js';
import { loadPool } from '../_shared/pool.js';
import { projectRound } from '../_shared/projection.js';
import { json } from './pool-count.js';

/** The client-visible shape of a round. */
function roundPayload(round) {
  return {
    id: round.id,
    round_number: round.round_number,
    template: round.template,
    prompt: round.prompt,
    context: round.context,
    clues: round.clues,
    options: round.options,
    reveal_schedule: round.reveal_schedule,
    started_at: round.started_at,
    deadline_at: round.deadline_at,
  };
}

export async function handleStartRoom(req, { createClient, env }) {
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
    if (!roomId) {
      return json({ error: 'room_id is required' }, 400);
    }

    const admin = makeClients({ createClient, env }).serviceClient();

    // The room, and the caller's right to start it.
    const { data: room, error: roomError } = await admin
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();
    if (roomError || !room) {
      return json({ error: 'no such room' }, 404);
    }

    const { data: membership } = await admin
      .from('room_memberships')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership?.is_host) {
      return json({ error: 'only the host starts the game' }, 403);
    }
    if (room.status !== 'lobby') {
      // A retry of a start that already happened. Return the round that
      // is already there rather than refusing - the caller wants to know
      // what is being played.
      const { data: existingRound } = await admin
        .from('rounds')
        .select('*')
        .eq('room_id', roomId)
        .eq('round_number', 1)
        .maybeSingle();
      if (!existingRound) {
        return json({ error: 'the game has already started' }, 409);
      }
      return json(roundPayload(existingRound));
    }

    const { data: file, error: fileError } = await admin.storage
      .from('pool')
      .createSignedUrl('pool.json', 600);
    if (fileError) throw fileError;
    const pool = await loadPool(file.signedUrl);

    const players = pool.players ?? [];

    // A preset room uses the preset's own clauses - the client cannot
    // change what a preset means. A crafted scope travels with the room
    // and is checked before it is planned.
    const preset = presetById(room.scope_id);
    let scope;
    if (preset) {
      scope = { clauses: preset.clauses };
    } else {
      const crafted = { clauses: room.scope_clauses ?? [] };
      const check = validateScope(crafted, { registry: pool.registry, players });
      if (!check.ok) {
        return json({ error: check.reason }, 422);
      }
      scope = crafted;
    }

    // A vibe with too few players cannot produce a quiz. Say so, with
    // the count, rather than letting the engine's own floor throw.
    const poolSize = scopePool(scope, players).length;
    if (poolSize < MIN_POOL) {
      return json({
        error: `Only ${poolSize} ${poolSize === 1 ? 'player' : 'players'} fit that vibe. A vibe needs at least ${MIN_POOL}.`,
      }, 422);
    }

    // A retry must play the SAME quiz. If the room already has a plan,
    // that plan is the quiz - a second one would leave the room playing
    // round one of one quiz and rounds two to ten of another.
    const { data: existing } = await admin
      .from('quiz_plans')
      .select('*')
      .eq('room_id', roomId)
      .maybeSingle();

    let projected = existing?.plan ?? null;
    let seed = existing?.seed ?? null;

    if (!projected) {
      seed = Number(crypto.getRandomValues(new BigUint64Array(1))[0] % 2147483647n);
      const quiz = planQuiz({
        scope,
        pool: players,
        registry: pool.registry,
        seed,
        rounds: room.total_rounds,
        difficulty: room.difficulty,
      });

      // The plan is stored once. The projection runs once. The database
      // copies jsonb from one round to the next.
      projected = quiz.rounds.map((round, i) => projectRound(round, i + 1));

      const { error: planError } = await admin.from('quiz_plans').insert({
        room_id: roomId,
        seed,
        plan: projected,
      });
      if (planError) {
        // Someone else got there first. Their plan is the quiz.
        const { data: theirs } = await admin
          .from('quiz_plans')
          .select('*')
          .eq('room_id', roomId)
          .single();
        projected = theirs.plan;
        seed = theirs.seed;
      }
    }

    const first = projected[0];
    const startedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 20000).toISOString();

    // If the round is already there, this is a retry: keep it.
    const { data: alreadyThere } = await admin
      .from('rounds')
      .select('*')
      .eq('room_id', roomId)
      .eq('round_number', first.client.round_number)
      .maybeSingle();

    let inserted = alreadyThere;
    if (!inserted) {
      const { data: created, error: roundError } = await admin
        .from('rounds')
        .insert({
          room_id: roomId,
          round_number: first.client.round_number,
          template: first.client.template,
          prompt: first.client.prompt,
          context: first.client.context,
          clues: first.client.clues,
          options: first.client.options,
          reveal_schedule: first.client.reveal_schedule,
          started_at: startedAt,
          deadline_at: deadlineAt,
        })
        .select()
        .single();
      if (roundError) {
        // The other call won the race. Their round is the round.
        const { data: theirs } = await admin
          .from('rounds')
          .select('*')
          .eq('room_id', roomId)
          .eq('round_number', first.client.round_number)
          .single();
        inserted = theirs;
      } else {
        inserted = created;
      }
    }

    await admin.from('round_secrets').upsert({
      round_id: inserted.id,
      answer_value: first.secret.answer_value,
      target_player_id: first.secret.target_player_id,
      unit: first.secret.unit,
    });

    await admin.from('rooms').update({
      status: 'round_active',
      current_round: 1,
      pool_size: scopePool(scope, players).length,
    }).eq('id', roomId).eq('status', 'lobby');

    return json(roundPayload(inserted));
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
