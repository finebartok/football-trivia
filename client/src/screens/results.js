import { el, mount, pointsLabel, shareText } from '../ui.js';
import { store } from '../store.js';
import { labelFor } from '../room-state.js';

export function render(root) {
  const roomState = store.state.room;
  if (roomState?.roomId) {
    renderRoom(root, roomState);
    return;
  }

  const quiz = store.state.quiz;
  if (!quiz) {
    location.hash = '#home';
    return;
  }

  const answers = store.state.answers;

  if (!answers.length) {
    mount(root, [
      el('header', { className: 'topbar' }, [
        el('a', { className: 'wordmark', text: '⚽ Football Trivia', attrs: { href: '#home' } }),
      ]),
      el('section', { className: 'card' }, [
        el('h1', { className: 'page-title', text: 'No rounds were played' }),
        el('p', { className: 'muted-note', text: 'There is nothing to show yet.' }),
        el('a', { className: 'btn btn--primary', text: 'Play a quiz', attrs: { href: '#vibes' } }),
      ]),
    ]);
    return;
  }

  const score = answers.reduce((sum, a) => sum + a.points, 0);
  const correct = answers.filter((a) => a.correct).length;
  const max = quiz.rounds.length * 7500;
  const summary = quiz.summary ?? {};

  const recapBits = [];
  // In v1 every round is "Who is this?", so one kind of question is not
  // worth a line.
  if (summary.metricFamilies > 1) {
    recapBits.push(`${summary.metricFamilies} different kinds of question`);
  }
  if (summary.hardestRound) recapBits.push(`hardest round: ${summary.hardestRound}`);
  const recap = recapBits.join(' · ');
  const recapText = recap ? recap[0].toUpperCase() + recap.slice(1) : '';

  const share = el('button', {
    className: 'btn',
    text: 'Copy your score',
    attrs: { type: 'button', id: 'btn-share' },
    on: {
      click: (e) => {
        const text = shareText({
          scopeName: store.state.scope?.name ?? 'Football Trivia',
          score,
          rounds: answers.length,
          recap: recapText,
        });
        navigator.clipboard?.writeText(text).then(() => {
          e.target.textContent = 'Copied';
        }).catch(() => {});
      },
    },
  });

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '⚽ Football Trivia', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'results-hero' }, [
      el('p', { className: 'results-hero__label', text: 'FINAL SCORE' }),
      el('p', { className: 'results-hero__score', text: pointsLabel(score), attrs: { id: 'final-score' } }),
      el('p', { className: 'muted-note', text: `${correct} of ${answers.length} correct` }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Your quiz' }),
      el('p', { className: 'muted-note', text: recapText || 'A fresh quiz is written every time you play.' }),
      el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: 'Points possible' }),
        el('span', { className: 'rank-row__points', text: pointsLabel(max) }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Round by round' }),
      ...answers.map((a, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `Round ${i + 1}` }),
        el('span', { className: `rank-row__points ${a.correct ? 'is-good' : 'is-bad'}`, text: pointsLabel(a.points, { signed: true }) }),
      ])),
    ]),

    el('a', {
      className: 'btn btn--primary results-cta',
      text: 'Craft your own vibe',
      attrs: { href: '#vibes' },
    }),
    share,
  ]);
}

/** The final leaderboard of a room. */
function renderRoom(root, roomState) {
  const board = roomState.leaderboard ?? [];
  const me = board.find((m) => m.user_id === roomState.me);
  const score = me?.total_score ?? 0;

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('a', { className: 'wordmark', text: '⚽ Football Trivia', attrs: { href: '#home' } }),
    ]),

    el('section', { className: 'results-hero' }, [
      el('p', { className: 'results-hero__label', text: 'FINAL SCORE' }),
      el('p', { className: 'results-hero__score', text: pointsLabel(score), attrs: { id: 'final-score' } }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'The room' }),
      ...board.map((m, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `${i + 1}. ${labelFor(roomState, m.user_id)}` }),
        el('span', { className: 'rank-row__points', text: pointsLabel(m.total_score) }),
      ])),
      el('p', { className: 'muted-note', text: 'A fresh quiz is written every time you play.' }),
    ]),

    el('a', {
      className: 'btn btn--primary results-cta',
      text: 'Craft your own vibe',
      attrs: { href: '#vibes' },
    }),
  ]);
}
