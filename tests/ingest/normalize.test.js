import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePosition, normaliseLeague, normalisePlayer, normaliseTransfer,
  resolveClubAliases,
} from '../../scripts/ingest/normalize.js';

test('normalisePosition maps TM sub-positions onto four game positions', () => {
  assert.equal(normalisePosition('Centre-Forward'), 'Forward');
  assert.equal(normalisePosition('Attacking Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Central Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Left-Back'), 'Defender');
  assert.equal(normalisePosition('Goalkeeper'), 'Goalkeeper');
  assert.equal(normalisePosition('Missing'), 'Unknown');
  assert.equal(normalisePosition(''), 'Unknown');
});

test('normalisePlayer keeps a missing stat as null, never zero', () => {
  const p = normalisePlayer({
    player_id: '1', name: 'Test Player', date_of_birth: '1990-01-02',
    country_of_citizenship: 'England', position: 'Centre-Forward',
    international_caps: '', market_value_in_eur: '0', foot: 'Right',
  });
  assert.equal(p.internationalCaps, null, 'empty caps must be null, not 0');
  assert.equal(p.marketValueEur, null, 'a zero market value is not a value');
  assert.equal(p.position, 'Forward');
});

test('normalisePlayer rejects a junk name', () => {
  assert.equal(normalisePlayer({ player_id: '2', name: 'without club', date_of_birth: '1990-01-01' }), null);
});

test('normalisePlayer preserves a non-ASCII name while folding it for matching', () => {
  const p = normalisePlayer({
    player_id: '3', name: 'Hakan Çalhanoğlu', date_of_birth: '1994-01-01',
    country_of_citizenship: 'Turkey', position: 'Central Midfield',
  });
  assert.equal(p.name, 'Hakan Çalhanoğlu');
  assert.equal(p.slug, 'hakan-calhanoglu');
});

test('resolveClubAliases maps an alias to exactly one club', () => {
  const clubs = [
    { id: 1, name: 'Arsenal FC', leagueId: 'GB1' },
    { id: 2, name: 'Arsenal Tula', leagueId: 'RU1' },
  ];
  const map = resolveClubAliases(clubs, ['Arsenal FC', 'Arsenal Tula']);
  assert.equal(map.get('arsenal fc'), 1);
  assert.equal(map.get('arsenal tula'), 2);
});

test('resolveClubAliases refuses an ambiguous alias', () => {
  const clubs = [
    { id: 1, name: 'Arsenal FC', leagueId: 'GB1' },
    { id: 2, name: 'Arsenal', leagueId: 'RU1' },
  ];
  const map = resolveClubAliases(clubs, ['Arsenal']);
  assert.equal(map.has('arsenal'), false, 'an alias matching two clubs must not resolve');
});

test('normalisePosition covers the real TM vocabulary in both columns', () => {
  // The coarse `position` column: only these four values occur in the source.
  assert.equal(normalisePosition('Defender'), 'Defender');
  assert.equal(normalisePosition('Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Attack'), 'Forward');
  assert.equal(normalisePosition('Goalkeeper'), 'Goalkeeper');
  assert.equal(normalisePosition('Missing'), 'Unknown');
  // And the specific `sub_position` column the brief's examples come from.
  assert.equal(normalisePosition('Centre-Back'), 'Defender');
  assert.equal(normalisePosition('Right-Back'), 'Defender');
  assert.equal(normalisePosition('Attacking Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Defensive Midfield'), 'Midfielder');
  assert.equal(normalisePosition('Centre-Forward'), 'Forward');
  assert.equal(normalisePosition('Second Striker'), 'Forward');
  assert.equal(normalisePosition('Left Winger'), 'Forward');
});

// --- Load-bearing behaviour the brief cannot know about -------------------

test('a slug folds the apostrophe without inserting a space', () => {
  const p = normalisePlayer({
    player_id: '4', name: "N'Golo Kanté", date_of_birth: '1991-03-29',
    position: 'Central Midfield',
  });
  assert.equal(p.name, "N'Golo Kanté");
  assert.equal(p.slug, 'ngolo-kante');
});

test('normalisePosition recognises Left-Back and the back/wing-back family as Defender', () => {
  assert.equal(normalisePosition('Left-Back'), 'Defender');
  assert.equal(normalisePosition('Right-Back'), 'Defender');
  assert.equal(normalisePosition('Left Winger'), 'Forward');
});

test('a player with no date of birth is unusable', () => {
  assert.equal(normalisePlayer({ player_id: '5', name: 'No DOB' }), null);
  assert.equal(normalisePlayer({ player_id: '5', name: 'Blank DOB', date_of_birth: '' }), null);
  assert.equal(normalisePlayer({ player_id: '5', name: 'Bad DOB', date_of_birth: 'not-a-date' }), null);
});

test('a timestamp-shaped date of birth keeps only the date part', () => {
  const p = normalisePlayer({
    player_id: '6', name: 'Full Stamp', date_of_birth: '1990-01-02 00:00:00',
  });
  assert.equal(p.dateOfBirth, '1990-01-02');
});

test('nationality is a one-element list, and absent nationality is an empty list', () => {
  const withNat = normalisePlayer({
    player_id: '7', name: 'Has Nat', date_of_birth: '1990-01-01',
    country_of_citizenship: 'France',
  });
  assert.deepEqual(withNat.citizenship, ['France']);
  const noNat = normalisePlayer({ player_id: '8', name: 'No Nat', date_of_birth: '1990-01-01' });
  assert.deepEqual(noNat.citizenship, []);
});

test('a zero height or market value means the source recorded nothing', () => {
  const p = normalisePlayer({
    player_id: '9', name: 'Zero Height',
    date_of_birth: '1990-01-01', height_in_cm: '0',
    highest_market_value_in_eur: '0',
  });
  assert.equal(p.heightCm, null);
  assert.equal(p.highestMarketValueEur, null);
});

test('a zero cap or goal count is a real value, unlike a blank one', () => {
  const zero = normalisePlayer({
    player_id: '9b', name: 'Uncapped Player',
    date_of_birth: '1990-01-01', international_caps: '0', international_goals: '0',
  });
  assert.equal(zero.internationalCaps, 0, 'a recorded zero caps is a fact, not a gap');
  assert.equal(zero.internationalGoals, 0);
  const blank = normalisePlayer({
    player_id: '9c', name: 'Blank Counts Player',
    date_of_birth: '1990-01-01', international_caps: '', international_goals: '',
  });
  assert.equal(blank.internationalCaps, null, 'a blank cap count is not a value');
  assert.equal(blank.internationalGoals, null);
});

test('normaliseLeague resolves a competition id or a display name, else null', () => {
  assert.equal(normaliseLeague('GB1'), 'GB1');
  assert.equal(normaliseLeague('Premier League'), 'GB1');
  assert.equal(normaliseLeague('la-liga'), 'ES1');
  assert.equal(normaliseLeague('Serie A'), 'IT1');
  assert.equal(normaliseLeague('Bundesliga'), 'L1');
  assert.equal(normaliseLeague(''), null);
  assert.equal(normaliseLeague('Cornwall Sunday League'), null);
});

test('normaliseTransfer keys the season by its start year and refuses junk endpoints', () => {
  const t = normaliseTransfer({
    player_id: '10', transfer_season: '2014/15', to_club_name: 'Arsenal FC',
    from_club_name: '', transfer_fee: '', market_value_in_eur: '5000000',
  });
  assert.equal(t.season, 2014);
  assert.equal(t.toClubName, 'Arsenal FC');
  assert.equal(t.fromClubName, null, 'a blank club name stays null');
  assert.equal(t.feeEur, null, 'an unrecorded fee is null, not a free transfer');
  assert.equal(t.marketValueEur, 5000000);
});

test('normaliseTransfer drops a transfer with no player, no season, or no real endpoint', () => {
  assert.equal(normaliseTransfer({ transfer_season: '2014', to_club_name: 'Arsenal FC' }), null);
  assert.equal(normaliseTransfer({ player_id: '11', to_club_name: 'Arsenal FC' }), null);
  assert.equal(normaliseTransfer({
    player_id: '11', transfer_season: '2014', to_club_name: 'without club', from_club_name: '',
  }), null);
});

test('resolveClubAliases refuses an alias that matches two clubs in different leagues', () => {
  const clubs = [
    { id: 1, name: 'Arsenal FC', leagueId: 'GB1' },
    { id: 2, name: 'Arsenal Tula', leagueId: 'RU1' },
  ];
  const map = resolveClubAliases(clubs, ['Arsenal']);
  assert.equal(map.has('arsenal'), false, 'a wrong club is worse than no club');
});

test('resolveClubAliases maps an unambiguous partial alias and skips an unknown one', () => {
  const clubs = [
    { id: 1, name: 'Manchester City', leagueId: 'GB1' },
    { id: 2, name: 'Manchester United', leagueId: 'GB1' },
    { id: 3, name: 'Chelsea FC', leagueId: 'GB1' },
  ];
  const map = resolveClubAliases(clubs, ['Chelsea', 'Nonexistent FC']);
  assert.equal(map.get('chelsea'), 3);
  assert.equal(map.has('nonexistent fc'), false);
  assert.equal(map.has('manchester'), false, 'two Manchester clubs make the alias ambiguous');
});

test('resolveClubAliases ignores a blank alias', () => {
  const clubs = [{ id: 1, name: 'Chelsea FC', leagueId: 'GB1' }];
  const map = resolveClubAliases(clubs, ['', '   ']);
  assert.equal(map.size, 0);
});
