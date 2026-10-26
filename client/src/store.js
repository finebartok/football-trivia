import { planQuiz } from '/js/engine/index.js';
import { loadPool, loadPoolMeta, poolFor, countFor, presetMatchesScope } from './pool.js';
import { room } from './room.js';

const VIBES_KEY = 'football-trivia-vibes';
const THEME_KEY = 'football-trivia-theme';

const state = {
  booting: true,
  poolError: null,
  poolLoading: null,
  // The counts from the published metadata, before any players arrive.
  poolCounts: null,
  countsTried: false,
  countsLoading: null,
  // Which game the player is in: 'solo' or 'room'. A player is in one
  // or the other, never both.
  mode: 'solo',
  pool: null,
  poolKey: null,
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
    // The players are fetched when a game needs them - a preset's lobby,
    // a hand-built vibe - and not on the home screen, so a player who
    // only joins a room never downloads the pool.
    await room.restore().catch(() => {});
    state.booting = false;
    notify();
  },
  /** The pool key that can serve this scope. */
  poolKeyFor(scope) {
    return presetMatchesScope(scope) ? scope.id : 'full';
  },

  /**
   * Fetch the players this scope needs.
   *
   * A preset gets a small slice. A hand-built vibe gets the full pool, and
   * the full pool can serve any scope once it is here.
   */
  async ensurePool(scope) {
    const key = this.poolKeyFor(scope);
    const ready = () => Boolean(state.pool)
      && (state.poolKey === key || state.poolKey === 'full');

    if (ready()) return state.pool;

    // Another screen may be loading a different key. Let it finish, then
    // decide again rather than returning a pool this scope cannot use.
    if (state.poolLoading) {
      try {
        await state.poolLoading;
      } catch {
        // The retry below reports the failure.
      }
      if (ready()) return state.pool;
    }

    state.poolLoading = (async () => {
      let pool;
      try {
        pool = await loadPool(key);
      } catch (err) {
        if (key === 'full') throw err;
        // Local development has no generated slices. The fixture still
        // holds every player.
        pool = await loadPool('full');
      }
      state.pool = pool;
      state.poolKey = pool.key;
      state.registry = pool.registry;
      state.poolError = null;
      notify();
      return pool;
    })()
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

  /**
   * Fetch the preset counts before the players arrive.
   *
   * The home screen only needs a number, not the whole pool. Without the
   * generated metadata - local development - it falls back to the pool.
   */
  async ensureCounts() {
    if (state.countsTried) return state.poolCounts;
    if (state.countsLoading) return state.countsLoading;
    state.countsTried = true;
    state.countsLoading = loadPoolMeta()
      .then((meta) => {
        state.poolCounts = meta?.counts ?? null;
        if (state.poolCounts) {
          notify();
          return state.poolCounts;
        }
        return this.ensurePool().then(() => state.poolCounts);
      })
      .catch(() => {
        state.poolCounts = null;
        return null;
      })
      .finally(() => {
        state.countsLoading = null;
      });
    return state.countsLoading;
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
    const pool = await this.ensurePool(scope);
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
