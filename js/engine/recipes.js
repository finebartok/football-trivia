import { seasonLabel } from '../../lib/seasons.js';

export const RECIPES = Object.freeze([
  {
    id: 'identify_in_window',
    family: 'identity',
    template: 'identify',
    metric: 'identity',
    windowKinds: ['career', 'season', 'season_range', 'tournament', 'club_stint', 'age_band'],
    speak: ({ subject, window }) => ({
      prompt: 'Who is this?',
      context: window?.label ?? null,
      answer: subject.name,
      unit: null,
    }),
  },
  {
    id: 'goals_in_season',
    family: 'window',
    template: 'stat_value',
    metric: 'club_goals',
    windowKinds: ['season'],
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did **${subject.name}** score for **${window?.teamName ?? window?.label ?? 'the club'}** in **${window?.seasonStart ? seasonLabel(window.seasonStart) : window?.label}**?`,
      context: window?.label ?? null,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'goals_in_tournament',
    family: 'roster',
    template: 'stat_value',
    metric: 'tournament_goals',
    windowKinds: ['tournament'],
    speak: ({ subject, window, value }) => ({
      prompt: `How many goals did **${subject.name}** score at the **${window?.label ?? 'tournament'}**?`,
      context: window?.label ?? null,
      answer: value,
      unit: 'goals',
    }),
  },
  {
    id: 'caps_total',
    family: 'career',
    template: 'stat_value',
    metric: 'international_caps',
    windowKinds: ['career', 'season', 'season_range', 'tournament'],
    speak: ({ subject, value }) => ({
      prompt: `How many international caps did **${subject.name}** have?`,
      context: null,
      answer: value,
      unit: 'caps',
    }),
  },
  {
    id: 'scarcity_goals',
    family: 'scarcity',
    template: 'identify',
    metric: 'scarcity_peers',
    windowKinds: ['career', 'season', 'season_range', 'tournament', 'age_band'],
    speak: ({ subject, value }) => ({
      prompt: `One of only **${value}** players did this — who?`,
      context: null,
      answer: subject.name,
      unit: null,
    }),
  },
]);

export function recipesFor({ template, window, pool }) {
  const kind = window?.kind ?? 'career';
  const subjects = pool ?? [];
  return RECIPES.filter(r => {
    if (template && r.template !== template) return false;
    if (!r.windowKinds.includes(kind)) return false;
    if (r.metric === 'identity') return true;
    return subjects.some(s => {
      if (r.metric === 'international_caps') return s.internationalCaps > 0;
      if (r.metric === 'tournament_goals') return window?.id && (s.windows?.[window.id]?.goals ?? 0) > 0;
      if (r.metric === 'scarcity_peers') return (s.stats?.scarcity_peers ?? 0) > 0;
      if (r.metric === 'club_goals') return window?.id && (s.windows?.[window.id]?.goals ?? 0) > 0;
      return false;
    });
  });
}
