import { el, mount, jerseyTile } from '../ui.js';
import { store } from '../store.js';
import { sounds, haptic } from '../sound.js';

// What the screen has already said. The screen is rebuilt on every
// redraw, and a player reading the answer should not hear it again.
let saidFor = null;
import { room } from '../room.js';

function findPlayer(id) {
  return (store.state.pool?.players ?? []).find((p) => p.id === id) ?? null;
}

export function render(root) {
  const roomState = store.state.room;
  const inRoom = Boolean(roomState?.roomId);

  if (inRoom) {
    renderRoom(root, roomState);
    return;
  }

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

  const verdictKey = inRoom
    ? `room-${roomState.answeredRound ?? roomState.currentRound}`
    : `solo-${store.state.roundIndex}`;
  if (saidFor !== verdictKey) {
    saidFor = verdictKey;
    if (answer?.correct) {
      sounds.right();
      haptic(30);
    } else {
      sounds.wrong();
      haptic(60);
    }
  }

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
  const answerText = withUnit(round.answer, round.unit);

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

/**
 * The reveal in a room.
 *
 * The answer is only available once the round has closed, so the screen
 * asks for it and waits. The next round starts on the server's clock,
 * not on this button.
 */
function renderRoom(root, roomState) {
  if (!roomState.lastResult && roomState.answeredRound) {
    // The answer only exists once the round has closed. Ask for it, and
    // ask again no more often than the poll - asking on every render
    // would fire hundreds of requests a second.
    const now = Date.now();
    if (!roomState.lastResultAskedAt || now - roomState.lastResultAskedAt > 2000) {
      roomState.lastResultAskedAt = now;
      room.result(roomState.answeredRound);
    }
    return;
  }

  const result = roomState.lastResult;
  const answer = roomState.myAnswer;
  const roundNumber = roomState.answeredRound ?? roomState.currentRound;

  // "1 goal", not "1". The unit belongs with the number.
  const answerText = withUnit(result?.answer, result?.unit);

  const next = el('button', {
    className: 'btn btn--primary',
    text: roomState.status === 'final' ? 'See how it went' : 'Next round',
    attrs: { type: 'button', id: 'btn-next' },
    on: {
      click: () => {
        if (roomState.status === 'final') {
          location.hash = '#results';
        } else {
          location.hash = '#round';
        }
      },
    },
  });

  const board = result?.leaderboard ?? [];
  const me = board.find((m) => m.user_id === roomState.me);

  // The room's reveal says it out loud too - the chime and the thud are
  // the cue, and the cue does not depend on who is playing.
  const roomKey = `room-${roomState.answeredRound ?? roomState.currentRound}`;
  if (saidFor !== roomKey) {
    saidFor = roomKey;
    if (answer?.correct) {
      sounds.right();
      haptic(30);
    } else {
      sounds.wrong();
      haptic(60);
    }
  }



  mount(root, [
    el('header', { className: 'topbar' }, [
      el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      el('span', { className: 'muted-note', text: `Round ${roundNumber}` }),
    ]),

    el('section', { className: 'reveal-card' }, [
      el('div', { className: 'tile', text: '?' }),
      el('h1', { className: 'reveal-card__name', text: answerText || '…' }),
    ]),

    el('section', { className: `card verdict ${answer?.correct ? 'is-good' : 'is-bad'}` }, [
      answer?.correct
        ? el('strong', { text: 'You got it' })
        : el('strong', { text: `It was ${answerText}` }),
      el('span', { className: 'verdict__points', text: `+${answer?.points ?? 0}` }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Running score' }),
      ...board.map((m, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `${i + 1}. ${m.display_name}` }),
        el('span', { className: 'rank-row__points', text: `${m.total_score}` }),
      ])),
      el('p', { className: 'muted-note', text: me ? `You have ${me.total_score} points` : '' }),
    ]),

    next,
  ].filter(Boolean));
}

/** A number with its unit: "3 goals", "1 goal". */
function withUnit(value, unit) {
  if (value === undefined || value === null) return '';
  if (!unit) return String(value);
  const n = Number(value);
  const u = (n === 1 && unit.endsWith('s')) ? unit.slice(0, -1) : unit;
  return `${value} ${u}`;
}
