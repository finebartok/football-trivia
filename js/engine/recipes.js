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
    phase: 'v1.1',
    family: 'window',
    template: 'stat_value',
    metric: 'club_goals',
    windowKinds: ['season'],
    speak: ({ subject, window, value }) => {
      const club = window?.teamName ?? null;
      const season = window?.seasonStart != null ? seasonLabel(window.seasonStart) : null;
      const seasonOrLabel = season ?? window?.label ?? null;
      // Never render the same string for club and season; fall back to a
      // single sensible phrase instead of repeating the label.
      const seasonPhrase = seasonOrLabel && seasonOrLabel !== club ? seasonOrLabel : null;
      const parts = [`How many goals did **${subject.name}** score`];
      if (club) parts.push(`for **${club}**`);
      if (seasonPhrase) parts.push(`in **${seasonPhrase}**`);
      return {
        prompt: parts.join(' ') + '?',
        context: window?.label ?? null,
        answer: value,
        unit: 'goals',
      };
    },
  },
  {
    id: 'goals_in_tournament',
    phase: 'v1.1',
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
    phase: 'v1.1',
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

/**
 * The recipes a game may use.
 *
 * A recipe that belongs to a later phase is not offered until that phase
 * asks for it. v1 is guess-the-player only - the v1 spec's D4 - so the
 * numeric templates wait rather than turning half the rounds into a
 * different game.
 */
export function recipesFor({ template, window, pool, phases = [] }) {
  const kind = window?.kind ?? 'career';
  const subjects = pool ?? [];
  return RECIPES.filter(r => {
    if (r.phase && !phases.includes(r.phase)) return false;
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
