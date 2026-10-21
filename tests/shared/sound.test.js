import test from 'node:test';
import assert from 'node:assert/strict';
import { sounds, isMuted, setMuted, toggleMute, haptic } from '../../client/src/sound.js';

test('a sound with no audio context does not throw', () => {
  // Node has no Web Audio, and neither has an old browser. The game
  // plays on in silence.
  assert.doesNotThrow(() => sounds.click());
  assert.doesNotThrow(() => sounds.right());
  assert.doesNotThrow(() => sounds.wrong());
  assert.doesNotThrow(() => sounds.tick());
  assert.doesNotThrow(() => sounds.reveal());
});

test('a haptic with no vibration does not throw', () => {
  assert.doesNotThrow(() => haptic(30));
  assert.doesNotThrow(() => haptic([10, 20, 10]));
});

test('the mute is remembered in both directions', () => {
  const before = isMuted();
  setMuted(true);
  assert.equal(isMuted(), true);
  setMuted(false);
  assert.equal(isMuted(), false);
  setMuted(before);
});

test('the mute toggles', () => {
  const before = isMuted();
  assert.equal(toggleMute(), !before);
  assert.equal(isMuted(), !before);
  setMuted(before);
});
