import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  photoFallback, licenceIsShippable, licenceFromExtMetadata, photoPlanFromEntities,
  resolvePhotoPlan, fetchLicence, ingestPhotos, sha256,
} from '../../scripts/ingest/photos.js';
import { openDb, applyMigrations } from '../../scripts/ingest/lib/db.js';

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../fixtures/ingest/dev-licence.json',
);
const licences = async () => new Map(Object.entries(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))));

test('the fallback tile is deterministic per player', () => {
  const a = photoFallback(42, 'Hakan Çalhanoğlu');
  const b = photoFallback(42, 'Hakan Çalhanoğlu');
  assert.deepEqual(a, b);
  assert.equal(a.initials, 'HÇ');
  assert.ok(/^hsl\(/.test(a.background));
});

test('the fallback tile is stable across name spellings and differs across players', () => {
  assert.deepEqual(
    photoFallback(42, 'Hakan Çalhanoğlu'),
    photoFallback(42, 'Hakan  Çalhanoğlu '),
  );
  assert.notDeepEqual(photoFallback(42, 'A B'), photoFallback(77, 'A B'));
  assert.notEqual(photoFallback(42, 'A B').background, photoFallback(77, 'A B').background);
});

test('only freely licensed images may be shipped', () => {
  assert.equal(licenceIsShippable({ licence: 'CC BY-SA 4.0' }), true);
  assert.equal(licenceIsShippable({ licence: 'CC0' }), true);
  assert.equal(licenceIsShippable({ licence: 'No restrictions' }), true);
  assert.equal(licenceIsShippable({ licence: 'Fair use' }), false);
  assert.equal(licenceIsShippable({ licence: 'Unknown' }), false);
});

test('photo plan takes the first P18 of each entity and skips entities without one', () => {
  const plan = photoPlanFromEntities({
    Q1: { claims: { P18: [{ mainsnak: { datavalue: { value: 'A player.jpg' } } }] } },
    Q2: { claims: {} },
    Q3: {},
  });
  assert.deepEqual(plan, [{
    wikidataId: 'Q1',
    fileName: 'A player.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/A%20player.jpg',
  }]);
});

test('photo resolution matches players by name and skips players that already have a photo', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true),
           ('ronaldo','Cristiano Ronaldo','1985-02-05','{Portugal}','Forward','{"status":"pass"}',true)`);
  await db.query(`insert into photos (id, player_id, storage_path, licence, source_url, is_primary)
    select 'p1', id, 'photos/1/x.webp', 'CC0', 'https://example.test/x.jpg', true
    from players where slug = 'ronaldo'`);

  const terms = [];
  const res = await resolvePhotoPlan(
    (await db.query('select id, name from player_pool')).rows,
    {
      db,
      search: async (term) => { terms.push(term); return [{ id: 'Q615', label: term, description: 'Argentine footballer' }]; },
      entities: async () => ({ Q615: { claims: { P18: [{ mainsnak: { datavalue: { value: 'Lionel Messi 20180626.jpg' } } }] } } }),
    },
  );

  assert.equal(res.skipped, 1, 'the player who already has a photo is not resolved again');
  assert.deepEqual(terms, ['Lionel Messi'], 'only the player without a photo is searched for');
  assert.deepEqual(res.unresolved, []);
  assert.deepEqual(res.plan, [{
    playerId: res.plan[0].playerId,
    wikidataId: 'Q615',
    fileName: 'Lionel Messi 20180626.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Lionel%20Messi%2020180626.jpg',
  }]);
  assert.equal((await db.query('select name from players where id=$1', [res.plan[0].playerId])).rows[0].name, 'Lionel Messi');
  await db.close();
});

test('a player with no Wikidata match, or no P18 image, is reported unresolved', async () => {
  const players = [{ id: 7, name: 'Nobody At All' }, { id: 8, name: 'No Image Person' }];
  const res = await resolvePhotoPlan(players, {
    search: async (term) => (term === 'Nobody At All'
      ? []
      : [{ id: 'Q8', label: term, description: 'English footballer' }]),
    entities: async () => ({ Q8: { claims: {} } }),
  });

  assert.deepEqual(res.plan, []);
  assert.deepEqual(res.unresolved, [
    { playerId: 7, name: 'Nobody At All', reason: 'no wikidata match' },
    { playerId: 8, name: 'No Image Person', reason: 'no P18 image' },
  ]);
});

test('fetchLicence maps raw Commons imageinfo responses into the licence map', async () => {
  const raw = {
    query: {
      pages: {
        '12345': {
          title: 'File:Example.jpg',
          imageinfo: [{
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
            width: 172,
            height: 178,
            extmetadata: {
              LicenseShortName: { value: 'Public domain' },
              Artist: { value: '<span>bdk</span>' },
              Credit: { value: '<span>Own work</span>' },
            },
          }],
        },
      },
    },
  };
  const got = await fetchLicence(['Example.jpg'], { fetchImpl: async () => ({ ok: true, json: async () => raw }) });
  assert.equal(got.get('Example.jpg').licence, 'Public domain');
  assert.equal(got.get('Example.jpg').attribution, 'bdk');
  assert.equal(got.get('Example.jpg').width, 172);
  assert.equal(got.get('Example.jpg').height, 178);
  assert.equal(got.get('Example.jpg').sourceUrl, 'https://commons.wikimedia.org/wiki/File:Example.jpg');
});

test('fetchLicence splits batches of more than fifty titles', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const titles = url.searchParams.get('titles').split('|');
    calls.push(titles.length);
    const pages = {};
    for (const t of titles) {
      const name = t.replace(/^File:/, '');
      pages[name] = { title: t, imageinfo: [{ descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`, extmetadata: { LicenseShortName: { value: 'CC0' } } }] };
    }
    return { ok: true, json: async () => ({ query: { pages } }) };
  };
  const names = Array.from({ length: 75 }, (_, i) => `File${i}.jpg`);
  const got = await fetchLicence(names, { fetchImpl });
  assert.deepEqual(calls, [50, 25]);
  assert.equal(got.size, 75);
});

test('ingest downloads the image url and stores the file page url from licence info', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('messi','Lionel Messi','1987-06-24','{Argentina}','Forward','{"status":"pass"}',true)`);
  const { rows: [{ id: playerId }] } = await db.query(`select id from players where slug='messi'`);

  const uploaded = new Map();
  const downloaded = [];
  const res = await ingestPhotos(db, {
    plan: [{ playerId, wikidataId: 'Q615', fileName: 'Example.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg' }],
    download: async (url) => { downloaded.push(url); return new Uint8Array([1, 2, 3, 4]); },
    resize: async () => ({ buffer: new Uint8Array([9, 9]), width: 512, height: 640 }),
    storage: { async upload(path, buffer) { uploaded.set(path, buffer); return path; } },
    licences: await licences(),
  });

  assert.deepEqual(res, { stored: 1, skipped: 0, fallback: 0, failures: [] });
  assert.equal(downloaded[0], 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg');
  const row = (await db.query('select * from photos')).rows[0];
  assert.equal(row.player_id, playerId);
  assert.equal(row.is_primary, true);
  assert.equal(row.width, 512);
  assert.equal(row.height, 640);
  assert.equal(row.licence, 'Public domain');
  assert.equal(row.attribution, null);
  assert.equal(row.source_url, 'https://commons.wikimedia.org/wiki/File:Example.jpg');
  assert.deepEqual([...uploaded.keys()], [`photos/${playerId}/${row.id}.webp`]);
  assert.equal(row.storage_path, `photos/${playerId}/${row.id}.webp`);
  assert.equal(row.id, sha256(new Uint8Array([9, 9])));
  await db.close();
});

test('a non-shippable licence is skipped and never written to photos', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('x','X Player','1990-01-01','{England}','Forward','{"status":"pass"}',true)`);
  const { rows: [{ id: playerId }] } = await db.query(`select id from players where slug='x'`);

  const res = await ingestPhotos(db, {
    plan: [{ playerId, wikidataId: 'Q1', fileName: 'Example.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg' }],
    download: async () => new Uint8Array([1]),
    resize: async () => ({ buffer: new Uint8Array([2]), width: 512, height: 512 }),
    storage: { async upload() { throw new Error('must not upload a non-shippable image'); } },
    licences: new Map([['Example.jpg', { licence: 'Fair use', attribution: 'Someone', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' }]]),
  });

  assert.deepEqual(res, { stored: 0, skipped: 1, fallback: 0, failures: [] });
  assert.equal((await db.query('select count(*)::int c from photos')).rows[0].c, 0);
  await db.close();
});

test('CC BY-SA without surviving attribution is skipped and never written to photos', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('z','Z Player','1990-01-01','{France}','Forward','{"status":"pass"}',true)`);
  const { rows: [{ id: playerId }] } = await db.query(`select id from players where slug='z'`);

  const res = await ingestPhotos(db, {
    plan: [{ playerId, wikidataId: 'Q3', fileName: 'Example.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg' }],
    download: async () => new Uint8Array([1]),
    resize: async () => ({ buffer: new Uint8Array([2]), width: 512, height: 512 }),
    storage: { async upload() { throw new Error('must not upload cc-by-sa without attribution'); } },
    licences: new Map([['Example.jpg', { licence: 'CC BY-SA 4.0', attribution: null, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' }]]),
  });

  assert.deepEqual(res, { stored: 0, skipped: 1, fallback: 0, failures: [] });
  assert.equal((await db.query('select count(*)::int c from photos')).rows[0].c, 0);
  await db.close();
});

test('a player whose download fails falls back to the jersey tile instead of a broken row', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('y','Y Player','1990-01-01','{England}','Forward','{"status":"pass"}',true)`);
  const { rows: [{ id: playerId }] } = await db.query(`select id from players where slug='y'`);

  const res = await ingestPhotos(db, {
    plan: [{ playerId, wikidataId: 'Q2', fileName: 'Example.jpg', sourceUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Example.jpg' }],
    download: async () => { throw new Error('404'); },
    storage: { async upload() { throw new Error('must not upload'); } },
    licences: await licences(),
  });

  assert.deepEqual(res, { stored: 0, skipped: 0, fallback: 1, failures: [{ playerId, stage: 'download/resize', message: '404' }] });
  assert.equal((await db.query('select count(*)::int c from photos')).rows[0].c, 0);
  await db.close();
});

test('downloading a non-Commons host is refused', async () => {
  const db = await openDb();
  await applyMigrations(db);
  await db.query(`insert into players (slug,name,date_of_birth,citizenship,position,quality,active)
    values ('tm','TM Player','1990-01-01','{Spain}','Forward','{"status":"pass"}',true)`);
  const { rows: [{ id: playerId }] } = await db.query(`select id from players where slug='tm'`);

  const res = await ingestPhotos(db, {
    plan: [{ playerId, wikidataId: 'Q4', fileName: 'bad.jpg', sourceUrl: 'https://cdn.transfermarkt.com/bad.jpg' }],
    download: async () => new Uint8Array([1]),
    resize: async () => ({ buffer: new Uint8Array([2]), width: 512, height: 512 }),
    storage: { async upload() { throw new Error('must not upload'); } },
    licences: new Map([['bad.jpg', { licence: 'Public domain', attribution: 'x', sourceUrl: 'https://commons.wikimedia.org/wiki/File:bad.jpg' }]]),
  });

  assert.deepEqual(res.fallback, 1);
  assert.deepEqual(res.stored, 0);
  assert.deepEqual(res.failures.length, 1);
  assert.equal((await db.query('select count(*)::int c from photos')).rows[0].c, 0);
  await db.close();
});
