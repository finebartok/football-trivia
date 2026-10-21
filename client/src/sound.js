/**
 * The game's voice.
 *
 * Every sound is synthesised: a short oscillator with a gain envelope.
 * There are no audio files, so there is nothing to download, nothing to
 * license and nothing to lose. A browser with no Web Audio plays on in
 * silence.
 *
 * The mute is remembered, in both directions, and the haptics follow it.
 */

const MUTE_KEY = 'football-trivia-muted';

/** The sounds, each a short shape of tones. */
const VOICES = {
  click: [{ freq: 660, at: 0, len: 0.05, gain: 0.16 }],
  right: [{ freq: 660, at: 0, len: 0.09, gain: 0.18 }, { freq: 990, at: 0.09, len: 0.16, gain: 0.18 }],
  wrong: [{ freq: 220, at: 0, len: 0.22, gain: 0.16, fall: 120 }],
  tick: [{ freq: 1200, at: 0, len: 0.03, gain: 0.1 }],
  reveal: [{ freq: 880, at: 0, len: 0.06, gain: 0.1 }],
};

let context = null;

/** The audio context, created on the first gesture. */
function audio() {
  if (context) return context;
  const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

/** Play one voice. A browser with no audio does nothing at all. */
function play(voice) {
  if (isMuted()) return;
  const ctx = audio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    for (const tone of voice) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(tone.freq, now + tone.at);
      if (tone.fall) osc.frequency.exponentialRampToValueAtTime(tone.fall, now + tone.at + tone.len);
      gain.gain.setValueAtTime(0.0001, now + tone.at);
      gain.gain.exponentialRampToValueAtTime(tone.gain, now + tone.at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + tone.at);
      osc.stop(now + tone.at + tone.len + 0.02);
    }
  } catch {
    // A sound that cannot be made is not an error. The game plays on.
  }
}

export const sounds = {
  click: () => play(VOICES.click),
  right: () => play(VOICES.right),
  wrong: () => play(VOICES.wrong),
  tick: () => play(VOICES.tick),
  reveal: () => play(VOICES.reveal),
};

// null means "not read yet". The value is kept in memory for the session
// and written to storage so it survives a reload, and so another tab on
// the same game can be told.
let muted = null;

export function isMuted() {
  if (muted === null) {
    try {
      muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // No storage to read: the sound is on unless it was muted in
      // memory.
      muted = false;
    }
  }
  return muted;
}

/** Read the stored choice again - another tab may have changed it. */
function refresh() {
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // No storage: keep what we have, rather than throwing the player's
    // choice away.
  }
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // A browser with no storage still mutes, for this session only.
  }
  try {
    // Another tab on the same game hears about it.
    globalThis.dispatchEvent(new CustomEvent('football-trivia:sound', { detail: { muted } }));
  } catch {
    // No event bus, no problem.
  }
}

export function toggleMute() {
  setMuted(!isMuted());
  return isMuted();
}

/** A short buzz. A browser without vibration does nothing. */
export function haptic(pattern) {
  if (isMuted()) return;
  try {
    globalThis.navigator?.vibrate?.(pattern);
  } catch {
    // No vibration, no problem.
  }
}

/** The button that turns the sound on and off. */
export function soundToggle() {
  const button = document.createElement('button');
  button.className = 'btn btn--icon btn--sound';
  button.type = 'button';
  button.id = 'btn-sound';
  const label = () => {
    const muted = isMuted();
    button.textContent = muted ? '🔇' : '🔊';
    button.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
    button.setAttribute('title', muted ? 'Sound is off' : 'Sound is on');
    button.setAttribute('aria-pressed', String(muted));
  };
  label();
  button.addEventListener('click', () => {
    toggleMute();
    label();
  });
  globalThis.addEventListener?.('football-trivia:sound', () => {
    refresh();
    label();
  });
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key === MUTE_KEY) refresh();
    label();
  });
  return button;
}
