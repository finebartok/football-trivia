/**
 * The room client.
 *
 * This is the only module in the browser that knows Supabase exists.
 * Everything else asks this one for the room's state.
 */
import { connect, myUserId, invokeFunction } from './supabase.js';
import { presetById } from '/js/presets.js';
import { applyRound, applyMembers, applyLeaderboard } from './room-state.js';

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
  error: null,
};

const listeners = new Set();
const ROOM_KEY = 'football-trivia-room';
let channel = null;
let pollTimer = null;
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
}

async function subscribe(roomId) {
  if (!client) return;
  if (channel) await client.removeChannel(channel);

  channel = client
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `room_id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_memberships', filter: `room_id=eq.${roomId}` }, () => sync())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, () => sync())
    .subscribe();
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { sync().catch(() => {}); }, POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Ask the server what is happening. Also drives the round advance. */
async function sync() {
  const supabase = client;
  if (!supabase || !state.roomId) return null;
  const { data, error } = await supabase.rpc('sync_room_state', { p_room_id: state.roomId });
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
    state.scopeIcon = preset?.icon ?? null;
  }

  // A player who reloaded does not remember what they answered. The
  // server does.
  if (data.my_answered_round) {
    state.answeredRound = data.my_answered_round;
    state.myAnswer = data.my_answer ?? state.myAnswer;
  }
  // The poll is also the heartbeat: the server marks a member offline
  // after thirty seconds without one, so it runs for as long as the
  // player is in the room.
  if (data.status === 'final' && pollTimer) stopPolling();
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

  async create({ scope }) {
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
    void 0;
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

  /** Lock an answer. The score comes back from the server. */
  async answer(guessed) {
    const supabase = await ensure();
    if (!supabase || !state.round) return null;
    const { status, data } = await invokeFunction('submit-answer', {
      room_id: state.roomId,
      round_number: state.round.round_number,
      guessed_answer: guessed,
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
    state.answeredRound = state.round.round_number;
    state.error = null;
    notify();
    return data;
  },

  /** The finished round: the answer and the leaderboard. */
  async result(roundNumber) {
    const supabase = client;
    if (!supabase || !state.roomId) return null;
    const { data, error } = await supabase.rpc('round_result', {
      p_room_id: state.roomId,
      p_round_number: roundNumber,
    });
    if (error) {
      // The round may still be open. That is not a failure the player
      // needs to hear about - the reveal is waiting for it.
      if (!String(error.message ?? '').includes('still open')) {
        state.error = friendly(error.message);
      }
      notify();
      return null;
    }
    // The round is still open: the reveal is waiting for it.
    if (data?.pending) {
      notify();
      return null;
    }
    state.lastResult = data;
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
  if (m.includes('fit that vibe')) return m;
  if (m.includes('not one the data knows')) return m;
  if (m.includes('has nothing in it')) return m;
  if (m.includes('is not something we can play')) return m;
  if (m.includes('unknown vibe')) return 'That vibe cannot be played in a room yet.';
  return 'Something went wrong. Try again.';
}
