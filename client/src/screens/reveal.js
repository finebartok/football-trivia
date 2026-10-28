import { el, mount, jerseyTile, pointsLabel } from '../ui.js';
import { careerClubs } from '/js/engine/index.js';
import { store } from '../store.js';
import { sounds, haptic } from '../sound.js';

// What the screen has already said. The screen is rebuilt on every
// redraw, and a player reading the answer should not hear it again.
let saidFor = null;
import { room } from '../room.js';
import { labelFor } from '../room-state.js';

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

  const path = careerClubs(player);

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
      el('span', { className: 'verdict__points', text: pointsLabel(answer?.points ?? 0, { signed: true }) }),
    ]),

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Running score' }),
      el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: 'You' }),
        el('span', { className: 'rank-row__points', text: pointsLabel(total) }),
      ]),
      el('p', { className: 'muted-note', text: `${correct} of ${store.state.answers.length} so far` }),
    ]),

    next,
  ].filter(Boolean));
}

/** "Alex", "Alex and Robin", "Alex, Robin and Sam". */
function namesFor(roomState, ids) {
  const names = ids.map((id) => labelFor(roomState, id));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Why the player is waiting, from their own effect rows. */
function waitingEffectLines(roomState, roundNumber) {
  const effects = (roomState.myEffects ?? [])
    .filter((e) => e.round_number === roundNumber);
  const thief = effects.find((e) => e.role === 'actor' && e.kind === 'steal');
  const victims = effects.filter((e) => e.role === 'target' && e.kind === 'steal');
  const bet = effects.find((e) => e.role === 'actor' && e.kind === 'side_bet');
  const usedSteal = effects.some((e) => e.role === 'actor' && e.kind === 'steal');
  const lines = [];

  if (thief) {
    lines.push(el('p', { className: 'muted-note', text: `You're copying ${labelFor(roomState, thief.other_id)}. The result appears when the round closes.` }));
  }
  if (victims.length) {
    const names = namesFor(roomState, victims.map((e) => e.other_id));
    lines.push(el('p', {
      className: 'muted-note',
      text: usedSteal
        ? `${names} ${victims.length === 1 ? 'is' : 'are'} copying you, but you used your steal — there is nothing to copy.`
        : `${names} ${victims.length === 1 ? 'is' : 'are'} copying your answer. Your answer is locked.`,
    }));
  }
  if (bet) {
    lines.push(el('p', { className: 'muted-note', text: `Side bet on ${labelFor(roomState, bet.other_id)}: +500 if they are right.` }));
  }
  return lines;
}

/** The reveal story for one effect. */
function effectStory(roomState, e, answer) {
  const me = roomState.me;
  const actor = labelFor(roomState, e.actor_id);
  const target = labelFor(roomState, e.target_id);

  if (e.kind === 'side_bet') {
    const bonus = e.bonus_points > 0 ? `+${pointsLabel(e.bonus_points)}` : 'no bonus';
    return e.actor_id === me
      ? `You bet on ${target}: ${bonus}.`
      : `${actor} bet on ${target}: ${bonus}.`;
  }

  if (e.actor_id === me) {
    if (e.target_stole) return `You copied ${target}, but ${target} used their own steal — nothing to copy.`;
    if (!e.target_answered) return `${target} didn't answer — nothing to copy.`;
    if (e.target_correct) return `You copied ${target}'s answer. ${target} was right — you earned ${pointsLabel(e.actor_points)}.`;
    return `You copied ${target}'s answer. ${target} was wrong — you got nothing.`;
  }

  if (e.target_id === me) {
    if (e.target_stole) return `${actor} copied you, but you used your steal — there was nothing to copy.`;
    if (!e.target_answered) return `${actor} tried to copy you, but you didn't answer.`;
    if (e.target_correct) return `${actor} copied your answer. You still earned ${pointsLabel(answer?.points ?? 0)}.`;
    return `${actor} copied your wrong answer — you both got nothing.`;
  }

  if (e.target_stole) return `${actor} copied ${target}, but ${target} used their own steal — nothing to copy.`;
  if (!e.target_answered) return `${actor} copied ${target} — nothing to copy.`;
  if (e.target_correct) return `${actor} copied ${target}. ${actor} earned ${pointsLabel(e.actor_points)}.`;
  return `${actor} copied ${target}'s wrong answer — neither scored.`;
}

/**
 * The reveal in a room.
 *
 * The answer is only available once the round has closed, so the screen
 * asks for it and waits. The next round starts on the server's clock,
 * not on this button.
 */
function renderRoom(root, roomState) {
  const answeredRound = roomState.answeredRound;
  const result = roomState.lastResult;
  const showResult = Boolean(result && result.round_number === answeredRound);

  if (!showResult && answeredRound) {
    // The answer only exists once the round has closed. Ask for it, and
    // ask again no more often than the poll.
    const now = Date.now();
    if (!roomState.lastResultAskedAt || now - roomState.lastResultAskedAt > 2000) {
      roomState.lastResultAskedAt = now;
      room.result(answeredRound);
    }
    mount(root, [
      el('header', { className: 'topbar' }, [
        el('span', { className: 'wordmark', text: '⚽ Football Trivia' }),
      ]),
      el('section', { className: 'card', attrs: { id: 'reveal-waiting' } }, [
        el('h1', { className: 'page-title', text: 'Waiting for the round to close' }),
        el('p', { className: 'muted-note', text: 'The answer is shown once everyone has answered or the time is up.' }),
        ...waitingEffectLines(roomState, answeredRound),
      ]),
    ]);
    return;
  }

  const answer = result?.my_answer ?? roomState.myAnswer;
  const roundNumber = result?.round_number ?? answeredRound ?? roomState.currentRound;

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

  const effects = result?.effects ?? [];
  const mySteal = effects.find((e) => e.kind === 'steal' && e.actor_id === roomState.me);
  const ordered = [...effects].sort((a, b) => {
    const aMine = a.actor_id === roomState.me || a.target_id === roomState.me ? 0 : 1;
    const bMine = b.actor_id === roomState.me || b.target_id === roomState.me ? 0 : 1;
    return aMine - bMine;
  });
  const effectsCard = effects.length
    ? el('section', { className: 'card', attrs: { id: 'effects-result' } }, [
      el('h2', { className: 'section-title', text: 'Effects' }),
      ...ordered.map((e) => el('p', { className: 'effect-line', text: effectStory(roomState, e, answer) })),
    ])
    : null;

  let verdictHeadline;
  if (mySteal) {
    const target = labelFor(roomState, mySteal.target_id);
    verdictHeadline = (mySteal.target_stole || !mySteal.target_answered)
      ? 'Nothing to copy'
      : `You copied ${target} — ${mySteal.target_correct ? 'correct' : 'wrong'}`;
  } else {
    verdictHeadline = answer?.correct ? 'You got it' : `It was ${answerText}`;
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
      el('strong', { text: verdictHeadline }),
      el('span', { className: 'verdict__points', text: pointsLabel(answer?.points ?? 0, { signed: true }) }),
    ]),

    effectsCard,

    el('section', { className: 'card' }, [
      el('h2', { className: 'section-title', text: 'Running score' }),
      ...board.map((m, i) => el('div', { className: 'rank-row' }, [
        el('span', { className: 'rank-row__name', text: `${i + 1}. ${labelFor(roomState, m.user_id)}` }),
        el('span', { className: 'rank-row__points', text: pointsLabel(m.total_score) }),
      ])),
      el('p', { className: 'muted-note', text: me ? `You have ${pointsLabel(me.total_score)} points` : '' }),
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
