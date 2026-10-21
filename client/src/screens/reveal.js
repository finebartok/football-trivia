import { el, mount, jerseyTile } from '../ui.js';
import { store } from '../store.js';

function findPlayer(id) {
  return (store.state.pool?.players ?? []).find((p) => p.id === id) ?? null;
}

export function render(root) {
  const quiz = store.state.quiz;
  const round = store.currentRound();
  const answer = store.state.answers[store.state.answers.length - 1];
  if (!quiz || !round) {
    location.hash = '#home';
    return;
  }

  const player = findPlayer(round.subjectId);
  const last = store.state.roundIndex >= quiz.rounds.length - 1;

  const total = store.state.answers.reduce((sum, a) => sum + a.points, 0);
  const correct = store.state.answers.filter((a) => a.correct).length;

  const next = el('button', {
    className: 'btn btn--primary',
    text: last ? 'See how it went' : 'Next round',
    attrs: { type: 'button', id: 'btn-next' },
    on: {
      click: () => {
        if (last) {
          location.hash = '#results';
        } else {
          store.startRound(store.state.roundIndex + 1);
          location.hash = '#round';
        }
      },
    },
  });

  // The answer needs its unit too: "It was 1 goal", not "It was 1".
  const answerText = (() => {
    if (!round.unit) return String(round.answer);
    const n = Number(round.answer);
    const unit = (n === 1 && round.unit.endsWith('s')) ? round.unit.slice(0, -1) : round.unit;
    return `${round.answer} ${unit}`;
  })();

  const facts = [];
  if (player) {
    if (player.citizenship?.length) facts.push(player.citizenship[0]);
    if (player.position) facts.push(player.position);
  }

  const path = (player?.teams ?? []).map((t) => t.clubName).filter(Boolean).slice(0, 4);

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      el('span', { className: 'muted-note', text: `Round ${round.stage}` }),
    ]),

    el('section', { className: 'reveal-card' }, [
      player
        ? jerseyTile(player, { size: 88 })
        : el('div', { className: 'tile', text: '?' }),
      el('h1', { className: 'reveal-card__name', text: round.subjectName }),
      el('p', { className: 'reveal-card__meta', text: facts.join(' · ') }),
      path.length ? el('p', { className: 'reveal-card__path', text: path.join(' → ') }) : null,
      round.context
        ? el('p', { className: 'reveal-card__context', text: round.context })
        : null,
    ]),

    el('section', { className: `card verdict ${answer?.correct ? 'is-good' : 'is-bad'}` }, [
      answer?.correct
        ? el('strong', { text: 'You got it' })
        : el('strong', { text: `It was ${answerText}` }),
      el('span', { className: 'verdict__points', text: `+${answer?.points ?? 0}` }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Running score' }),
      el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: 'You' }),
        el('span', { className: 'rank-row__points', text: `${total}` }),
      ]),
      el('p', { className: 'muted-note', text: `${correct} of ${store.state.answers.length} so far` }),
    ]),

    next,
  ].filter(Boolean));
}
