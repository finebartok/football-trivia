import { el, mount } from '../ui.js';
import { store, notify } from '../store.js';
import { room } from '../room.js';
import { labelFor } from '../room-state.js';
import { answerRound, STAGE_MULTIPLIERS, resolveWindow } from '/js/engine/index.js';
import { sounds, soundToggle, haptic } from '../sound.js';

const ROUND_MS = 20000;
const LETTERS = ['A', 'B', 'C', 'D'];

// What the screen has already said. It lives outside the screen because
// the screen is rebuilt on every redraw - and in a room that is every
// two seconds.
let revealedBefore = 0;
let lastTick = null;
let lastRoundKey = null;

// The picker survives the two-second redraw. It resets when the round
// changes, and the selected target is kept across a redraw.
let picker = null;
let pickedTarget = null;
let pickerRound = null;

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

  // A rematch returns the room to its lobby; the round screen has nothing
  // to show.
  if (store.state.mode === 'room' && roomState?.status === 'lobby' && !roomState.round) {
    location.hash = '#room-lobby';
    return;
  }

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

  // The server's clock, not this device's. A phone whose clock has
  // drifted would otherwise reveal the clues at its own moment, and
  // every player would see a different round.
  const clockOffset = inRoom ? (roomState.clockOffset ?? 0) : 0;
  const now = () => Date.now() + clockOffset;

  const timerEl = el('span', { className: 'round-timer', attrs: { id: 'round-timer' } });

  // The clue ladder is built once and only its classes change.
  // One step per clue. A ladder with a step the round never reaches
  // promises a clue that never comes.
  const stepEls = round.clues.map((_, i) => {
    const n = i + 1;
    return el('div', {
      className: 'step',
      text: `×${STAGE_MULTIPLIERS[n]}`,
      attrs: { 'aria-label': `Stage ${n}, multiplier ${STAGE_MULTIPLIERS[n]}` },
    });
  });
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
        sounds.click();
        const elapsed = Math.max(0, now() - startedAt);
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
    el('span', { className: 'option__letter', text: LETTERS[i], attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'option__label', text: opt.label }),
  ]));
  const optionsHost = el('div', { attrs: { id: 'round-options' } }, optionEls);

  const roundKey = inRoom
    ? `room-${roomState.round.round_number}`
    : `solo-${store.state.roundIndex}`;
  if (roundKey !== lastRoundKey) {
    lastRoundKey = roundKey;
    revealedBefore = 0;
    lastTick = null;
  }

  const roundNumber = inRoom ? roomState.round.round_number : null;
  if (pickerRound !== roundNumber) {
    picker = null;
    pickedTarget = null;
    pickerRound = roundNumber;
  }

  const mine = inRoom ? (roomState.myEffects ?? []) : [];
  const stealUsed = mine.some((e) => e.role === 'actor' && e.kind === 'steal');
  const betUsed = mine.some((e) => e.role === 'actor' && e.kind === 'side_bet');
  const pendingBet = mine.find((e) => e.role === 'actor' && e.kind === 'side_bet' && !e.resolved);
  const thieves = mine.filter((e) => e.role === 'target' && e.kind === 'steal'
    && e.round_number === roundNumber);
  const others = inRoom
    ? (roomState.members ?? []).filter((m) => m.user_id !== roomState.me)
    : [];

  const namesFor = (ids) => {
    const names = ids.map((id) => labelFor(roomState, id));
    if (names.length <= 1) return names[0] ?? '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  };

  const warningEl = thieves.length
    ? el('p', { className: 'effects__warning', attrs: { id: 'steal-warning' } }, [
      el('strong', { text: `${namesFor(thieves.map((e) => e.other_id))} ${thieves.length === 1 ? 'is' : 'are'} copying your answer.` }),
      el('span', { text: ' Answering wrong burns them — but you lose the points too.' }),
    ])
    : null;

  const effectsHost = el('div', { className: 'effects', attrs: { id: 'effects' } });
  const showEffects = inRoom && others.length > 0;

  const paintEffects = () => {
    const errorEl = inRoom && roomState.error
      ? el('p', { className: 'notice notice--warn', attrs: { id: 'room-error' } }, roomState.error)
      : null;

    if (!showEffects) {
      mount(effectsHost, [errorEl]);
      return;
    }

    const expiredNow = now() >= deadline;

    if (picker) {
      if (pickedTarget && !others.some((m) => m.user_id === pickedTarget)) {
        pickedTarget = null;
      }
      const targetName = pickedTarget ? labelFor(roomState, pickedTarget) : '';
      const heading = picker === 'steal' ? "Copy a friend's answer" : 'Bet on a friend';
      const rows = others.map((m) => el('button', {
        className: `picker__row ${pickedTarget === m.user_id ? 'is-picked' : ''}`,
        attrs: { type: 'button' },
        on: {
          click: () => {
            pickedTarget = m.user_id;
            paintEffects();
          },
        },
      }, [
        el('span', { className: 'picker__name', text: labelFor(roomState, m.user_id) }),
        el('span', { className: 'picker__state', text: m.online ? 'online' : 'away' }),
      ]));

      const confirm = el('button', {
        className: 'btn btn--primary',
        text: picker === 'steal'
          ? (targetName ? `Copy ${targetName}'s answer` : 'Pick a friend')
          : (targetName ? `Bet on ${targetName}` : 'Pick a friend'),
        attrs: { type: 'button', id: 'btn-effect-confirm' },
      });
      confirm.disabled = !pickedTarget || expiredNow;
      confirm.addEventListener('click', async () => {
        if (!pickedTarget || expiredNow) return;
        confirm.disabled = true;
        const data = await room.useEffect(picker, pickedTarget);
        if (!data) {
          confirm.disabled = false;
          return;
        }
        picker = null;
        pickedTarget = null;
        if (data.kind === 'steal') {
          location.hash = '#reveal';
          return;
        }
        // The sync redraw happened while the picker was still open, so
        // close it with a fresh render rather than patching a host that
        // was replaced by that redraw.
        notify();
      });

      const cost = picker === 'steal'
        ? "You won't answer this round. If they haven't answered, they can burn you. One steal per game."
        : "+500 if they are right and you answer or steal this round. They won't know until the reveal. One side bet per game.";

      mount(effectsHost, [
        errorEl,
        warningEl,
        el('div', { className: 'picker', attrs: { id: 'effect-picker' } }, [
          el('p', { className: 'picker__heading', text: heading }),
          ...rows,
          el('p', { className: 'muted-note', text: cost }),
          confirm,
          el('button', {
            className: 'btn btn--secondary',
            text: 'Cancel',
            attrs: { type: 'button', id: 'btn-effect-cancel' },
            on: {
              click: () => {
                picker = null;
                pickedTarget = null;
                paintEffects();
              },
            },
          }),
        ]),
      ]);
      return;
    }

    const stealButton = el('button', {
      className: 'btn btn--effect',
      text: stealUsed ? 'Steal used' : 'Steal a friend',
      attrs: { type: 'button', id: 'btn-steal' },
      on: {
        click: () => {
          if (stealUsed || now() >= deadline) return;
          picker = 'steal';
          pickedTarget = null;
          paintEffects();
        },
      },
    });
    const betButton = el('button', {
      className: 'btn btn--effect',
      text: betUsed ? 'Side bet used' : 'Side bet',
      attrs: { type: 'button', id: 'btn-side-bet' },
      on: {
        click: () => {
          if (betUsed || now() >= deadline) return;
          picker = 'side_bet';
          pickedTarget = null;
          paintEffects();
        },
      },
    });
    stealButton.disabled = stealUsed || expiredNow;
    betButton.disabled = betUsed || expiredNow;

    mount(effectsHost, [
      errorEl,
      warningEl,
      el('p', { className: 'effects__title', text: 'EFFECTS — ONCE PER GAME' }),
      el('div', { className: 'effects__row' }, [stealButton, betButton]),
      pendingBet
        ? el('p', { className: 'effects__pending', text: `Side bet on ${labelFor(roomState, pendingBet.other_id)}: +500 if they are right.` })
        : null,
    ]);
  };

  const paint = () => {
    const elapsed = Math.max(0, now() - startedAt);
    const revealed = revealedStages(round, elapsed);

    // One note per clue, not one per tick - and not one per redraw
    // either. The room redraws every two seconds, and a player reading
    // the clues should not watch them fade in again and again.
    if (revealed > revealedBefore) {
      for (let i = revealedBefore; i < revealed; i++) {
        clueEls[i].cardEl.classList.add('is-new');
        sounds.reveal();
        haptic(10);
      }
      revealedBefore = revealed;
    }
    // The deadline is a moment, not a length: what is left is the
    // difference between it and now.
    const remaining = Math.max(0, deadline - now());
    const expired = remaining <= 0;

    // The clock is the only thing under pressure.
    const secondsLeft = Math.ceil(remaining / 1000);
    if (secondsLeft > 0 && secondsLeft <= 5 && secondsLeft !== lastTick) {
      lastTick = secondsLeft;
      sounds.tick();
    }

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

    for (const id of ['btn-steal', 'btn-side-bet', 'btn-effect-confirm']) {
      const b = effectsHost.querySelector(`#${id}`);
      if (!b) continue;
      if (id === 'btn-steal') b.disabled = expired || stealUsed;
      else if (id === 'btn-side-bet') b.disabled = expired || betUsed;
      else b.disabled = expired || !pickedTarget;
    }
  };

  paintEffects();
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

  // The room stores the prompt and the hook in one text column, so the
  // line break is the seam. A solo round carries them separately.
  const [promptText, ...promptHook] = String(round.prompt ?? '').split('\n');
  const hookText = round.hook ?? promptHook.join(' ').trim();

  mount(root, [
    el('header', { className: 'topbar' }, [
      el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      timerEl,
      soundToggle(),
    ]),

    el('div', { className: 'banner', attrs: { id: 'window-banner' } }, [
      el('span', { text: windowLabel.toUpperCase() }),
    ]),

    // What is being asked. The clue ladder is how the answer is found;
    // this is what says what the answer is.
    promptText
      ? el('p', { className: 'round-prompt', text: promptText })
      : null,
    hookText
      ? el('p', { className: 'round-hook', text: hookText })
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
    effectsHost,
    optionsHost,
  ]);

  window.addEventListener('hashchange', stopTimer, { once: true });
}
