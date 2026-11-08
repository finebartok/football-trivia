/**
 * The room client.
 *
 * This is the only module in the browser that knows Supabase exists.
 * Everything else asks this one for the room's state.
 */
import { connect, myUserId, invokeFunction } from './supabase.js';
import { presetById } from '/js/presets.js';
import {
  applyRound,
  applyMembers,
  applyLeaderboard,
  applyEffects,
  applyReactions,
} from './room-state.js';

const POLL_MS = 2000;

const state = {
  connected: false,
  me: null,
  active: false,
  roomId: null,
  code: null,
  status: 'lobby',
  scopeId: null,
  scopeName: null,
  scopeIcon: null,
  gameMode: 'guess_player',
  // How far this device's clock is from the server's, in milliseconds.
  clockOffset: 0,
  members: [],
  leaderboard: [],
  round: null,
  currentRound: 0,
  totalRounds: 10,
  answeredCount: 0,
  myAnswer: null,
  answeredRound: null,
  fetchingResult: false,
  lastResult: null,
  myEffects: [],
  reactionsRound: null,
  reactions: [],
  reportedRound: null,
  error: null,
};

const listeners = new Set();
const ROOM_KEY = 'football-trivia-room';
let channel = null;
let pollTimer = null;
let currentPollInterval = null;
let client = null;
let me = null;

function notify() {
  for (const fn of listeners) fn();
}

/**
 * Remember the room, so a refresh comes back to it.
 *
 * A phone that sleeps and wakes, or a page that reloads, has to find its
 * way back to the game with its score intact.
 */
function persist() {
  try {
    localStorage.setItem(ROOM_KEY, JSON.stringify({
      roomId: state.roomId,
      code: state.code,
      scopeId: state.scopeId,
      scopeName: state.scopeName,
      scopeIcon: state.scopeIcon,
    }));
  } catch (err) {
    // A browser with no storage still works, it just forgets.
  }
}

function stored() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_KEY) ?? 'null');
  } catch (err) {
    return null;
  }
}

async function ensure() {
  if (client) return client;
  client = await connect();
  if (client) {
    me = await myUserId();
    state.me = me;
    state.connected = true;
  }
  return client;
}

function applyPayload(payload) {
  if (!payload) return;
  applyRound(state, payload);
  if (payload.members) applyMembers(state, payload.members);
  if (payload.leaderboard) applyLeaderboard(state, payload.leaderboard);
  if (payload.my_effects) applyEffects(state, payload.my_effects);
  applyReactions(state, payload);
}

async function subscribe(roomId) {
  if (!client) return;
  if (channel) await client.removeChannel(channel);

  channel = client
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, () => sync())
    // Joins arrive at once. Updates do not: every sync writes the
    // caller's last_seen_at, and an UPDATE subscription would make each
    // sync trigger the next one. The poll covers names and host changes.
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_memberships', filter: `room_id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_effects', filter: `room_id=eq.${roomId}` }, () => sync())
    .subscribe();
}

function startPolling(ms = POLL_MS) {
  if (pollTimer && currentPollInterval === ms) return;
  stopPolling();
  currentPollInterval = ms;
  pollTimer = setInterval(() => { sync().catch(() => {}); }, ms);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    currentPollInterval = null;
  }
}

/** Ask the server what is happening. Also drives the round advance. */
async function sync() {
  const supabase = client;
  if (!supabase || !state.roomId) return null;
  const { data, error } = await supabase.rpc('sync_room_state', {
    p_room_id: state.roomId,
    p_on_demand: true,
  });
  if (error) {
    state.error = friendly(error.message);
    notify();
    return null;
  }
  // The poll does not clear an error: the player has to see it, and
  // only the next thing they do clears it.
  applyPayload(data);

  // The room knows which vibe it is playing. A player who joined is told.
  if (data.scope_id) {
    const preset = presetById(data.scope_id);
    state.scopeId = data.scope_id;
    state.scopeName = data.scope_name || preset?.name || null;
    // A crafted vibe has no preset to look the icon up from, so the
    // room carries it.
    state.scopeIcon = data.scope_icon ?? preset?.icon ?? null;
  }

  // A room's mode is the room's, not this device's. Old servers do not
  // send one, so guess-the-player stays the default.
  state.gameMode = data.game_mode ?? state.gameMode ?? 'guess_player';

  // The server's clock travels with the state: a phone whose own clock
  // has drifted must still see the clues at the same moment as everybody
  // else.
  if (data.server_now) {
    state.clockOffset = Date.parse(data.server_now) - Date.now();
  }

  // A player who reloaded does not remember what they answered. The
  // server does.
  if (data.my_answered_round) {
    state.answeredRound = data.my_answered_round;
    state.myAnswer = data.my_answer ?? state.myAnswer;
  }
  // The poll is also the heartbeat: the server marks a member offline
  // after thirty seconds without one, so it runs for as long as the
  // player is in the room. A final room keeps a slow poll; a rematch returning to
  // the lobby restores the fast poll, even for a client that missed the realtime
  // update.
  if (data.status === 'final') {
    startPolling(5000);
    // The reveal asks for the round's result, and retries on the next
    // redraw. The final poll is the last redraw: fetch the result here
    // rather than leaving a pending ask unanswered.
    if (state.answeredRound && state.lastResult?.round_number !== state.answeredRound) {
      void room.result(state.answeredRound);
    }
  } else if (data.status === 'lobby') {
    startPolling(POLL_MS);
  }
  notify();
  return data;
}

export const room = {
  state,

  sync,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** The room state, for the screens. */
  get current() {
    return state;
  },

  /**
   * An error belongs to the screen that asked. Leaving that screen drops
   * it, so "Something went wrong" never follows the player around.
   */
  clearError() {
    if (state.error === null) return;
    state.error = null;
    notify();
  },

  async create({ scope, gameMode = 'guess_player' }) {
    const supabase = await ensure();
    if (!supabase) {
      state.error = 'Multiplayer is unavailable right now.';
      notify();
      return null;
    }
    // A preset room is named by its preset, so the server resolves the
    // scope itself. A crafted scope travels with the room and is checked
    // by the server before it is planned.
    const preset = presetById(scope.id);
    const isPreset = Boolean(preset)
      && JSON.stringify(preset.clauses) === JSON.stringify(scope.clauses ?? []);

    const { data, error } = await supabase.rpc('create_room', {
      p_scope_id: isPreset ? preset.id : 'custom',
      p_scope_clauses: scope.clauses ?? [],
      p_display_name: scope.displayName ?? 'Host',
      p_scope_name: scope.name ?? null,
      p_scope_icon: scope.icon ?? null,
      p_game_mode: gameMode,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.roomId = data.id;
    state.active = true;
    state.code = data.code;
    state.scopeId = scope.id;
    state.scopeName = scope.name;
    state.scopeIcon = scope.icon ?? null;
    state.gameMode = data.game_mode ?? gameMode ?? 'guess_player';
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
    state.status = data.status;
    state.error = null;
    persist();
    await subscribe(data.id);
    startPolling();
    await sync();
    notify();
    return data;
  },

  async join({ code, displayName }) {
    const supabase = await ensure();
    if (!supabase) {
      state.error = 'Multiplayer is unavailable right now.';
      notify();
      return null;
    }
    const { data, error } = await supabase.rpc('join_room', {
      p_code: code,
      p_display_name: displayName,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.roomId = data.id;
    state.active = true;
    state.code = data.code;
    state.status = data.status;
    // join_room returns the room row, so a guest learns the mode before
    // the first sync.
    state.gameMode = data.game_mode ?? 'guess_player';
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
    state.error = null;
    persist();
    await subscribe(data.id);
    startPolling();
    await sync();
    notify();
    return data;
  },

  /**
   * Come back to the room this browser was last in.
   *
   * The room id is read from storage before the SDK has loaded, so a
   * reload knows which room it is in even before it can talk to the
   * server.
   */
  async restore() {
    const saved = stored();
    if (!saved?.roomId) return null;

    state.roomId = saved.roomId;
    state.active = true;
    state.code = saved.code ?? null;
    state.scopeId = saved.scopeId ?? null;
    state.scopeName = saved.scopeName ?? null;
    state.scopeIcon = saved.scopeIcon ?? null;
    notify();

    const supabase = await ensure();
    if (!supabase) return null;

    await subscribe(state.roomId);
    startPolling();
    return sync();
  },

  /** Change your own name in the room. */
  async setName(displayName) {
    const supabase = await ensure();
    if (!supabase || !state.roomId) return null;
    const { error } = await supabase.rpc('set_display_name', {
      p_room_id: state.roomId,
      p_display_name: displayName,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    await sync();
    notify();
    return true;
  },

  async leave() {
    if (!client || !state.roomId) return;
    await client.rpc('leave_room', { p_room_id: state.roomId });
    stopPolling();
    if (channel) {
      await client.removeChannel(channel);
      channel = null;
    }
    state.roomId = null;
    state.active = false;
    state.code = null;
    state.myAnswer = null;
    state.answeredRound = null;
    state.lastResult = null;
    state.myEffects = [];
    state.reactionsRound = null;
    state.reactions = [];
    state.reportedRound = null;
    state.lastResultAskedAt = null;
    try {
      localStorage.removeItem(ROOM_KEY);
    } catch (err) {
      // Nothing to forget.
    }
    state.members = [];
    state.leaderboard = [];
    state.round = null;
    notify();
  },

  async start() {
    const supabase = await ensure();
    if (!supabase) return null;
    state.error = null;
    const { status, data } = await invokeFunction('start-room', { room_id: state.roomId });
    if (status !== 200) {
      state.error = friendly(data?.error);
      notify();
      return null;
    }
    state.error = null;
    startPolling();
    await sync();
    notify();
    return data;
  },

  /** Return the finished room to its lobby for a fresh game. */
  async rematch() {
    const supabase = await ensure();
    if (!supabase || !state.roomId) return false;
    state.error = null;
    const { data, error } = await supabase.rpc('reset_room', { p_room_id: state.roomId });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return false;
    }
    await sync();
    notify();
    return data?.ok === true;
  },

  /** Lock an answer. The score comes back from the server. */
  async answer(guessed, roundNumber) {
    const supabase = await ensure();
    if (!supabase || !state.round) return null;
    if (roundNumber !== state.round.round_number) return null;
    const { status, data } = await invokeFunction('submit-answer', {
      room_id: state.roomId,
      round_number: state.round.round_number,
      guessed_answer: guessed,
      on_demand: true,
    });
    if (status !== 200) {
      state.error = friendly(data?.error);
      notify();
      return null;
    }
    state.myAnswer = data;
    // Remember which round this was. The room moves on to the next one
    // as soon as the round closes, and the reveal still needs to know
    // which round it is revealing.
    state.answeredRound = roundNumber;
    state.error = null;
    notify();
    return data;
  },

  /** Reveal the next clue for this player. The server owns the index. */
  async revealClue() {
    const supabase = await ensure();
    if (!supabase || !state.round) return null;
    const { data, error } = await supabase.rpc('reveal_clue', {
      p_room_id: state.roomId,
      p_round_number: state.round.round_number,
      p_clue_index: state.round.clue_index ?? 0,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    if (state.round && data?.round_number === state.round.round_number) {
      state.round = {
        ...state.round,
        clue_index: data.clue_index,
        clue_total: data.clue_total,
        clues: data.clues,
      };
    }
    state.error = null;
    notify();
    return data;
  },

  /** Spend the one steal or the one side bet. */
  async useEffect(kind, targetUserId) {
    const supabase = await ensure();
    if (!supabase || !state.roomId || !state.round) return null;
    const { data, error } = await supabase.rpc('use_room_effect', {
      p_room_id: state.roomId,
      p_round_number: state.round.round_number,
      p_kind: kind,
      p_target_user_id: targetUserId,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    // The server's round, not the possibly stale local one. The round
    // screen routes on this and the reveal asks for this round.
    if (kind === 'steal') state.answeredRound = data.round_number;
    await sync();
    notify();
    return data;
  },

  /**
   * One reaction per player per round. The server keeps the first tap;
   * a retry returns the stored choice. The local row makes the chip lock
   * immediately, before the next poll confirms it.
   */
  async react(roundNumber, reaction) {
    const supabase = await ensure();
    if (!supabase || !state.roomId) return null;
    const { data, error } = await supabase.rpc('react_to_round', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
      p_reaction: reaction,
    });
    if (error) {
      state.error = friendly(error.message);
      notify();
      return null;
    }
    state.error = null;
    const stored = data?.reaction ?? reaction;
    const current = state.reactionsRound === roundNumber ? state.reactions : [];
    const me = state.members.find((m) => m.user_id === state.me);
    state.reactions = [
      ...current.filter((r) => r.user_id !== state.me),
      {
        user_id: state.me,
        display_name: me?.display_name ?? 'You',
        reaction: stored,
      },
    ];
    state.reactionsRound = roundNumber;
    notify();
    return data;
  },

  /**
   * One report per player per round. The dialog owns the error so it can
   * stay open with the player's reason and note intact; this method does
   * not write state.error for a failed report.
   */
  async reportQuestion(roundNumber, reason, note = '') {
    const supabase = await ensure();
    if (!supabase || !state.roomId) {
      return { ok: false, message: 'Multiplayer is unavailable right now.' };
    }
    const { error } = await supabase.rpc('report_round', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
      p_reason: reason,
      p_note: note ?? '',
    });
    if (error) return { ok: false, message: friendly(error.message) };
    state.reportedRound = roundNumber;
    state.error = null;
    notify();
    return { ok: true };
  },

  /** The finished round: the answer and the leaderboard. */
  async result(roundNumber) {
    const supabase = client;
    if (!supabase || !state.roomId) return null;
    if (roundNumber !== state.answeredRound) return null;
    const { data, error } = await supabase.rpc('round_result', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
    });
    if (error) {
      if (!String(error.message ?? '').includes('still open')) {
        state.error = friendly(error.message);
      }
      notify();
      return null;
    }
    if (data?.pending) {
      notify();
      return null;
    }
    // The room may have advanced while this request was in flight. A
    // result for another round must not overwrite the current answer.
    if (roundNumber !== state.answeredRound) return null;
    state.lastResult = data;
    if (data.my_answer) state.myAnswer = data.my_answer;
    applyLeaderboard(state, data.leaderboard);
    notify();
    return data;
  },

  dispose() {
    stopPolling();
    if (client && channel) client.removeChannel(channel);
    channel = null;
  },
};

/** A server error, said the way a player would say it. */
function friendly(message) {
  const m = String(message ?? '');
  if (m.includes('already started')) return 'That game has already started. Join the next one.';
  if (m.includes('no room has that code')) return 'No room has that code.';
  if (m.includes('room is full')) return 'That room is full.';
  if (m.includes('too late')) return 'Too late - that round is over.';
  if (m.includes('not signed in')) return 'Could not sign you in. Try again.';
  if (m.includes('already used that effect')) return 'You already used that effect this game.';
  if (m.includes('already answered')) return 'You already answered this round.';
  if (m.includes('copying a player')) return "You're copying a player this round. No answer of your own.";
  if (m.includes('not in the room')) return 'That player is no longer in the room.';
  if (m.includes('not a member of that room')) return "You're not in that room.";
  if (m.includes('effect on yourself')) return "You can't use an effect on yourself.";
  if (m.includes('game is not running')) return 'That game is not running.';
  if (m.includes('round is not open')) return 'That round is over.';
  if (m.includes('only the host')) return 'Only the host can start a rematch.';
  if (m.includes('not finished')) return 'That game has not finished yet.';
  if (m.includes('fit that vibe')) return m;
  if (m.includes('not one the data knows')) return m;
  if (m.includes('has nothing in it')) return m;
  if (m.includes('is not something we can play')) return m;
  if (m.includes('unknown vibe')) return 'That vibe cannot be played in a room yet.';
  if (m.includes('the round is still open')) return 'The result is not ready yet.';
  if (m.includes('unknown reaction')) return 'That reaction is not one we know.';
  if (m.includes('unknown reason')) return 'Pick a reason for the report.';
  if (m.includes('note is too long')) return 'That note is too long.';
  if (m.includes('no such round')) return 'That round is gone.';
  return 'Something went wrong. Try again.';
}
