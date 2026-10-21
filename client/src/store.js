import { planQuiz } from '/js/engine/index.js';
import { loadPool, poolFor, countFor } from './pool.js';

const VIBES_KEY = 'football-trivia-vibes';
const THEME_KEY = 'football-trivia-theme';

const state = {
  pool: null,
  registry: null,
  scope: null,
  quiz: null,
  roundIndex: 0,
  roundStartedAt: 0,
  answers: [],
  theme: 'retro',
  vibes: [],
};

const listeners = new Set();

function notify() {
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
    const pool = await loadPool();
    state.pool = pool;
    state.registry = pool.registry;
    this.loadVibes();
    this.loadTheme();
    notify();
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
    const pool = state.pool;
    if (!pool) throw new Error('pool not loaded');
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
