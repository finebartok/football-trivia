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

function ladder(round, elapsed) {
  const revealed = revealedStages(round, elapsed);
  const steps = [1, 2, 3, 4].map((n) => STAGE_MULTIPLIERS[n]);
  return el('div', { className: 'clue-ladder', attrs: { id: 'clue-ladder' } },
    steps.map((mult, i) => el('div', {
      className: `step ${i < revealed ? 'is-done' : ''} ${i === revealed ? 'is-current' : ''}`,
      text: `×${mult}`,
      attrs: { 'aria-label': `Stage ${i + 1}, multiplier ${mult}` },
    })));
}

export function render(root) {
  stopTimer();

  const quiz = store.state.quiz;
  const round = store.currentRound();
  if (!quiz || !round) {
    location.hash = '#home';
    return;
  }

  const startedAt = store.state.roundStartedAt || Date.now();
  const started = Date.now();

  const clueHost = el('div', { attrs: { id: 'clue-cards' } });
  const timerEl = el('span', { className: 'round-timer', attrs: { id: 'round-timer' } });
  const optionsHost = el('div', { attrs: { id: 'round-options' } });

  const paint = () => {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const revealed = revealedStages(round, elapsed);
    const remaining = Math.max(0, ROUND_MS - elapsed);

    timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;
    timerEl.className = `round-timer ${remaining < 5000 ? 'is-urgent' : ''}`;

    // clue cards: revealed ones show their value, unrevealed ones show a lock
    mount(clueHost, round.clues.map((clue, i) => {
      const shown = i < revealed;
      return el('div', {
        className: `clue-card ${shown ? 'is-revealed' : 'is-locked'}`,
      }, [
        el('span', { className: 'clue-card__label', text: clue.label }),
        el('span', { className: 'clue-card__value', text: shown ? clue.value : '— — —' }),
      ]);
    }));

    // options: the engine's own, in the engine's own order
    mount(optionsHost, round.options.map((opt, i) => el('button', {
      className: 'option',
      // Only set the attribute when it should be present: a null attribute
      // value still renders as the string "null", which disables the button.
      attrs: { type: 'button', ...(remaining <= 0 ? { disabled: 'disabled' } : {}) },
      on: {
        click: () => {
          const scored = answerRound(round, {
            answer: opt.label,
            stage: Math.max(1, revealed),
            elapsedMs: elapsed,
          });
          store.recordAnswer({
            roundIndex: store.state.roundIndex,
            stage: Math.max(1, revealed),
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
    ])));
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

    ladder(round, Date.now() - startedAt),
    clueHost,
    optionsHost,
  ]);

  // The timer must not keep running once the screen is replaced.
  window.addEventListener('hashchange', stopTimer, { once: true });
  void started;
}
