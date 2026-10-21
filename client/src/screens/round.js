import { el, mount } from '../ui.js';
import { store } from '../store.js';
import { room } from '../room.js';
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
  const roomState = store.state.room;
  // A room that exists is not the same as being in one. A player with a
  // room open can still start a solo game.
  const inRoom = store.state.mode === 'room' && Boolean(roomState?.round);

  // The server's round is the engine's round with one key renamed: the
  // column is reveal_schedule, the engine calls it revealSchedule.
  const round = inRoom
    ? { ...roomState.round, revealSchedule: roomState.round.reveal_schedule ?? [] }
    : store.currentRound();

  if (!round || (!inRoom && !quiz)) {
    location.hash = '#home';
    return;
  }

  // The round has already been answered - the reveal screen is next.
  // In a room the check is which round: the player answered the last one,
  // but they can still answer this one.
  const answered = inRoom
    ? roomState.answeredRound === roomState.round.round_number
    : store.state.answers.some((a) => a.roundIndex === store.state.roundIndex);
  if (answered) {
    location.hash = '#reveal';
    return;
  }

  // In a room the server decides when the round started. The client
  // renders the same absolute schedule, so two phones reveal the same
  // clue at the same moment.
  const startedAt = inRoom
    ? new Date(roomState.round.started_at).getTime()
    : (store.state.roundStartedAt || Date.now());

  const deadline = inRoom
    ? new Date(roomState.round.deadline_at).getTime()
    : startedAt + ROUND_MS;

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
      click: async () => {
        const elapsed = Math.max(0, Date.now() - startedAt);
        const stage = Math.max(1, revealedStages(round, elapsed));
        if (inRoom) {
          // The server decides whether the answer was right and what it
          // is worth. The client never scores its own game.
          const scored = await room.answer(opt.value ?? opt.label);
          if (!scored) return;
          location.hash = '#reveal';
          return;
        }
        const scored = answerRound(round, { answer: opt.value ?? opt.label, stage, elapsedMs: elapsed });
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
    const remaining = Math.max(0, deadline - elapsed);
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
  const windowLabel = round.context
    ?? scopeWindow?.label
    ?? store.state.scope?.name
    ?? roomState.scopeName
    ?? '';

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      timerEl,
    ]),

    el('div', { className: 'banner', attrs: { id: 'window-banner' } }, [
      el('span', { text: windowLabel.toUpperCase() }),
    ]),

    // What is being asked. The clue ladder is how the answer is found;
    // this is what says what the answer is.
    round.prompt
      ? el('p', { className: 'round-prompt', text: round.prompt })
      : null,

    el('div', { className: 'round-meta' }, [
      el('span', {
        className: 'muted-note',
        text: inRoom
          ? `Round ${roomState.round.round_number} of ${roomState.totalRounds}`
          : `Round ${round.stage} of ${quiz.rounds.length}`,
      }),
    ]),

    ladderEl,
    clueHost,
    optionsHost,
  ]);

  window.addEventListener('hashchange', stopTimer, { once: true });
}
