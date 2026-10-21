/**
 * Start the game.
 *
 * The plan is generated here, on the server, and never leaves it. The
 * client gets the first round's clues and options and nothing else.
 */
import { planQuiz, scopePool } from '../../../js/engine/index.js';
import { presetById } from '../../../js/presets.js';
import { makeClients } from '../_shared/supabase.js';
import { loadPool } from '../_shared/pool.js';
import { projectRound } from '../_shared/projection.js';
import { json } from './pool-count.js';

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
      return json({ error: 'the game has already started' }, 409);
    }

    // The scope comes from the preset, never from the client.
    const preset = presetById(room.scope_id);
    if (!preset) {
      return json({ error: 'unknown vibe' }, 400);
    }
    const scope = { clauses: preset.clauses };

    const { data: file, error: fileError } = await admin.storage
      .from('pool')
      .createSignedUrl('pool.json', 600);
    if (fileError) throw fileError;
    const pool = await loadPool(file.signedUrl);

    const players = pool.players ?? [];
    const seed = Number(crypto.getRandomValues(new BigUint64Array(1))[0] % 2147483647n);

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
    const projected = quiz.rounds.map((round, i) => projectRound(round, i + 1));

    await admin.from('quiz_plans').upsert({
      room_id: roomId,
      seed,
      plan: projected,
    });

    const first = projected[0];
    const startedAt = new Date().toISOString();
    const deadlineAt = new Date(Date.now() + 20000).toISOString();

    const { data: inserted, error: roundError } = await admin
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
    if (roundError) throw roundError;

    await admin.from('round_secrets').insert({
      round_id: inserted.id,
      answer_value: first.secret.answer_value,
      target_player_id: first.secret.target_player_id,
    });

    await admin.from('rooms').update({
      status: 'round_active',
      current_round: 1,
      pool_size: scopePool(scope, players).length,
    }).eq('id', roomId);

    return json({
      id: inserted.id,
      round_number: first.client.round_number,
      template: first.client.template,
      prompt: first.client.prompt,
      context: first.client.context,
      clues: first.client.clues,
      options: first.client.options,
      reveal_schedule: first.client.reveal_schedule,
      started_at: startedAt,
      deadline_at: deadlineAt,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
}
