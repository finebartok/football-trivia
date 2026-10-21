import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { answerRound, STAGE_MULTIPLIERS, resolveWindow } from '/js/engine/index.js';

const ROUND_MS = 20000;
const LETTERS = ['A', 'B', 'C', 'D'];

let timer = null;

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Which stages have been revealed by now. */
function revealedStages(round, elapsed) {
  return round.revealSchedule.filter((s) => elapsed >= s.revealAtMs).length;
}

export function render(root) {
  stopTimer();

  const quiz = store.state.quiz;
  const round = store.currentRound();
  if (!quiz || !round) {
    location.hash = '#home';
    return;
  }

  // The round has already been answered - the reveal screen is next.
  if (store.state.answers.some((a) => a.roundIndex === store.state.roundIndex)) {
    location.hash = '#reveal';
    return;
  }

  const startedAt = store.state.roundStartedAt || Date.now();

  const timerEl = el('span', { className: 'round-timer', attrs: { id: 'round-timer' } });

  // The clue ladder is built once and only its classes change.
  const stepEls = [1, 2, 3, 4].map((n) => el('div', {
    className: 'step',
    text: `×${STAGE_MULTIPLIERS[n]}`,
    attrs: { 'aria-label': `Stage ${n}, multiplier ${STAGE_MULTIPLIERS[n]}` },
  }));
  const ladderEl = el('div', { className: 'clue-ladder', attrs: { id: 'clue-ladder' } }, stepEls);

  // The clue cards are built once; only their value text changes. Rebuilding
  // them on every tick would swap the element under the player's finger.
  const clueEls = round.clues.map((clue) => {
    const valueEl = el('span', { className: 'clue-card__value', text: '— — —' });
    const cardEl = el('div', { className: 'clue-card is-locked' }, [
      el('span', { className: 'clue-card__label', text: clue.label }),
      valueEl,
    ]);
    return { cardEl, valueEl };
  });
  const clueHost = el('div', { attrs: { id: 'clue-cards' } }, clueEls.map((c) => c.cardEl));

  // The options are built once, in the engine's own order, and are NEVER
  // rebuilt. If they were, a press that started on one button and ended on
  // its replacement would never fire a click - the browser needs mousedown
  // and mouseup on the same element.
  const optionEls = round.options.map((opt, i) => el('button', {
    className: 'option',
    attrs: { type: 'button' },
    on: {
      click: () => {
        const elapsed = Math.max(0, Date.now() - startedAt);
        const stage = Math.max(1, revealedStages(round, elapsed));
        const scored = answerRound(round, { answer: opt.label, stage, elapsedMs: elapsed });
        store.recordAnswer({
          roundIndex: store.state.roundIndex,
          stage,
          correct: scored.correct,
          points: scored.points,
          chosen: opt.label,
          answer: round.answer,
        });
        location.hash = '#reveal';
      },
    },
  }, [
    el('span', { className: 'option__letter', text: LETTERS[i] }),
    el('span', { className: 'option__label', text: opt.label }),
  ]));
  const optionsHost = el('div', { attrs: { id: 'round-options' } }, optionEls);

  const paint = () => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const revealed = revealedStages(round, elapsed);
    const remaining = Math.max(0, ROUND_MS - elapsed);
    const expired = remaining <= 0;

    timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;
    timerEl.className = `round-timer ${remaining < 5000 ? 'is-urgent' : ''}`;

    clueEls.forEach((c, i) => {
      const shown = i < revealed;
      c.valueEl.textContent = shown ? round.clues[i].value : '— — —';
      c.cardEl.classList.toggle('is-revealed', shown);
      c.cardEl.classList.toggle('is-locked', !shown);
    });

    stepEls.forEach((s, i) => {
      s.classList.toggle('is-done', i < revealed);
      s.classList.toggle('is-current', i === revealed);
    });

    optionEls.forEach((b) => {
      if (b.disabled !== expired) b.disabled = expired;
    });
  };

  paint();
  timer = setInterval(paint, 100);

  // The banner names the WINDOW the quiz is about, which belongs to the vibe -
  // not to the individual question. Some question types carry no context of
  // their own, so falling back to round.context alone would make the banner
  // change from round to round.
  const scopeWindow = resolveWindow(store.state.scope, store.state.registry);
  const windowLabel = scopeWindow?.label ?? round.context ?? store.state.scope?.name ?? '';

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      timerEl,
    ]),

    el('div', { className: 'banner', attrs: { id: 'window-banner' } }, [
      el('span', { text: windowLabel.toUpperCase() }),
    ]),

    el('div', { className: 'round-meta' }, [
      el('span', { className: 'muted-note', text: `Round ${round.stage} of ${quiz.rounds.length}` }),
    ]),

    ladderEl,
    clueHost,
    optionsHost,
  ]);

  window.addEventListener('hashchange', stopTimer, { once: true });
}
