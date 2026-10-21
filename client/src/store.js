import { planQuiz } from '/js/engine/index.js';
import { loadPool, poolFor, countFor } from './pool.js';
import { room } from './room.js';

const VIBES_KEY = 'football-trivia-vibes';
const THEME_KEY = 'football-trivia-theme';

const state = {
  booting: true,
  poolError: null,
  poolLoading: null,
  // Which game the player is in: 'solo' or 'room'. A player is in one
  // or the other, never both.
  mode: 'solo',
  pool: null,
  registry: null,
  scope: null,
  quiz: null,
  roundIndex: 0,
  roundStartedAt: 0,
  answers: [],
  theme: 'retro',
  vibes: [],
  room: null,
};

const listeners = new Set();

// The room client owns the room's state; the store mirrors it so the
// screens can read it the same way they read everything else.
let wasInRoom = false;

room.subscribe(() => {
  state.room = room.state;
  // Which game the player is in follows the room, but only when the
  // membership changes: a poll must not pull a player who has started a
  // solo game back into the room.
  if (room.state.active !== wasInRoom) {
    wasInRoom = room.state.active;
    state.mode = wasInRoom ? 'room' : 'solo';
  }
  notify();
});

export function notify() {
  for (const fn of listeners) fn();
}

function persist() {
  try {
    localStorage.setItem(VIBES_KEY, JSON.stringify(state.vibes));
  } catch (err) {
    // localStorage may be unavailable or quota-exceeded; vibes are ephemeral then.
  }
}

export const store = {
  get state() {
    return state;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async init() {
    this.loadVibes();
    this.loadTheme();
    // The pool is 3.7MB. It is fetched when a screen needs it - the
    // vibe cards, the pool count, a solo game - and not before, so a
    // player who only joins a room never downloads it.
    await room.restore().catch(() => {});
    state.booting = false;
    notify();
  },
  /** Fetch the player pool, once. */
  async ensurePool() {
    if (state.pool) return state.pool;
    if (state.poolLoading) return state.poolLoading;
    state.poolLoading = loadPool()
      .then((pool) => {
        state.pool = pool;
        state.registry = pool.registry;
        state.poolError = null;
        notify();
        return pool;
      })
      .catch((err) => {
        // The failure is kept, not swallowed: the screen says so and
        // offers a way to try again.
        state.poolError = 'Could not load the players. Check your connection.';
        notify();
        throw err;
      })
      .finally(() => {
        state.poolLoading = null;
      });
    return state.poolLoading;
  },

  /** Try the pool again, after it failed. */
  async retryPool() {
    state.poolLoading = null;
    state.poolError = null;
    notify();
    try {
      await this.ensurePool();
    } catch {
      // The message is already on the screen.
    }
  },
  setScope(scope) {
    state.scope = scope;
    state.quiz = null;
    state.roundIndex = 0;
    state.answers = [];
    notify();
  },
  setTheme(name) {
    state.theme = name;
    try {
      localStorage.setItem(THEME_KEY, name);
    } catch (err) {
      // a theme that cannot be persisted is still applied for this session
    }
    notify();
  },
  loadTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'retro' || saved === 'editorial') state.theme = saved;
    } catch (err) {
      // fall back to the default theme
    }
    return state.theme;
  },
  async startQuiz({ scope, seed }) {
    state.mode = 'solo';
    const pool = await this.ensurePool();
    const quiz = planQuiz({
      scope,
      pool: pool.players,
      registry: pool.registry,
      seed,
      rounds: 10,
      difficulty: 'medium',
    });
    state.quiz = quiz;
    state.roundIndex = 0;
    state.answers = [];
    state.roundStartedAt = Date.now();
    notify();
    return quiz;
  },
  startRound(index) {
    state.roundIndex = index;
    state.roundStartedAt = Date.now();
    notify();
  },
  recordAnswer(entry) {
    state.answers = [...state.answers, entry];
    notify();
  },
  currentRound() {
    if (state.mode === 'room' && state.room?.round) return state.room.round;
    if (!state.quiz) return null;
    return state.quiz.rounds[state.roundIndex] ?? null;
  },
  saveVibe(vibe) {
    const entry = {
      id: vibe.id || crypto.randomUUID(),
      name: vibe.name,
      icon: vibe.icon,
      clauses: vibe.clauses,
    };
    state.vibes = [...state.vibes, entry];
    persist();
    notify();
    return entry;
  },
  loadVibes() {
    try {
      const raw = localStorage.getItem(VIBES_KEY);
      state.vibes = raw ? JSON.parse(raw) : [];
    } catch (err) {
      state.vibes = [];
    }
    return state.vibes;
  },
  deleteVibe(id) {
    state.vibes = state.vibes.filter((v) => v.id !== id);
    persist();
    notify();
  },
  poolFor,
  countFor,
};
