import { el, mount, shareText } from '../ui.js';
import { store } from '../store.js';

export function render(root) {
  const quiz = store.state.quiz;
  if (!quiz) {
    location.hash = '#home';
    return;
  }

  const answers = store.state.answers;
  const score = answers.reduce((sum, a) => sum + a.points, 0);
  const correct = answers.filter((a) => a.correct).length;
  const max = quiz.rounds.length * 7500;
  const summary = quiz.summary ?? {};

  const recapBits = [];
  if (summary.metricFamilies) recapBits.push(`${summary.metricFamilies} different kinds of question`);
  if (summary.hardestRound) recapBits.push(`hardest round: ${summary.hardestRound}`);
  const recap = recapBits.join(' · ');

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
          recap: recap ? `This quiz had ${recap}` : '',
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
      el('p', { className: 'results-hero__score', text: String(score), attrs: { id: 'final-score' } }),
      el('p', { className: 'muted-note', text: `${correct} of ${answers.length} correct` }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Your quiz' }),
      el('p', { className: 'muted-note', text: recap || 'A fresh quiz is written every time you play.' }),
      el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: 'Score' }),
        el('span', { className: 'rank-row__points', text: `${score} / ${max}` }),
      ]),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Round by round' }),
      ...answers.map((a, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `Round ${i + 1}` }),
        el('span', { className: `rank-row__points ${a.correct ? 'is-good' : 'is-bad'}`, text: `+${a.points}` }),
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
