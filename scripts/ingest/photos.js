// Player photos come from Wikidata P18 -> Wikimedia Commons, and nowhere else.
// The Transfermarkt CSV dump is CC0, but the dump's licence covers the dumper's
// work, not the pixels: TM CDN images are agency-licensed and must never be
// downloaded or shipped. Commons-only keeps every stored image free and
// attributable.
//
// A player with no free photo is a first-class card state, not a broken image:
// photoFallback is the deterministic jersey tile the same component renders.
import crypto from 'node:crypto';
import { searchEntity, getEntities } from './lib/wikidata.js';

const USER_AGENT = 'FootballTriviaBuild/1.0 (https://github.com/dcaribou/transfermarkt-datasets)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const TARGET_WIDTH = 512;
const TITLE_BATCH = 50;

const SHIPPABLE = new Set(['cc by-sa 4.0', 'cc by-sa 3.0', 'cc by-sa 2.0', 'cc by 4.0', 'cc by 3.0',
  'cc by 2.0', 'cc0', 'public domain', 'no restrictions', 'pd-self']);

export function licenceIsShippable({ licence }) {
  return SHIPPABLE.has(String(licence ?? '').trim().toLowerCase());
}

export function photoFallback(playerId, name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  const hue = Math.abs(Number(playerId) || 0) % 36;
  return {
    initials: (first + last).toUpperCase(),
    background: `hsl(${hue}, 55%, 42%)`,
    positionGlyph: 'chevron',
  };
}

export function photoPlanFromEntities(entities) {
  const plan = [];
  for (const [qid, e] of Object.entries(entities)) {
    const p18 = e?.claims?.P18;
    if (!p18?.length) continue;
    const file = p18[0]?.mainsnak?.datavalue?.value;
    if (!file) continue;
    plan.push({
      wikidataId: qid,
      fileName: file,
      sourceUrl: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`,
    });
  }
  return plan;
}

export function licenceFromExtMetadata(extmetadata) {
  const licence = extmetadata?.LicenseShortName?.value ?? 'Unknown';
  const attribution = extmetadata?.Artist?.value ?? extmetadata?.Credit?.value ?? null;
  return { licence, attribution, width: null, height: null };
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stripHtml(value) {
  return value == null ? null : String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}

/** Commons `imageinfo` in batches of 50 titles -> Map<fileName, info>. */
export async function fetchLicence(fileNames, { fetchImpl = fetch } = {}) {
  const out = new Map();
  for (let i = 0; i < fileNames.length; i += TITLE_BATCH) {
    const chunk = fileNames.slice(i, i + TITLE_BATCH);
    const url = new URL(COMMONS_API);
    url.search = new URLSearchParams({
      action: 'query',
      titles: chunk.map(f => (f.startsWith('File:') ? f : `File:${f}`)).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|extmetadata',
      format: 'json',
    });
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`commons imageinfo -> ${res.status}`);
    const json = await res.json();
    for (const page of Object.values(json.query?.pages ?? {})) {
      const title = String(page.title ?? '').replace(/^File:/, '');
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const meta = licenceFromExtMetadata(info.extmetadata);
      out.set(title, {
        licence: stripHtml(meta.licence) ?? 'Unknown',
        attribution: stripHtml(meta.attribution),
        sourceUrl: info.descriptionurl ?? photoPlanFromEntities({})[0]?.sourceUrl ?? null,
        width: info.width ?? null,
        height: info.height ?? null,
      });
    }
  }
  return out;
}

const PHOTO_SOURCE_ID = 'wikimedia_commons';

async function upsertSource(db) {
  await db.query(
    `insert into sources (id, licence, url) values ($1, $2, $3) on conflict (id) do nothing`,
    [PHOTO_SOURCE_ID, 'CC0 / CC BY-SA / public domain (per file)', 'https://commons.wikimedia.org/'],
  );
}

/**
 * Find a Wikidata QID + P18 filename for players with no photo yet.
 * `search` defaults to Wikidata's wbsearchentities; `getEntities` is injected so
 * tests never touch the network.
 */
export async function resolvePhotoPlan(playerRows, { db, search = searchEntity, entities = getEntities } = {}) {
  const withPhoto = new Set();
  if (db) {
    withPhoto.add(...(await db.query(
      'select player_id from photos where is_primary',
    )).rows.map(r => String(r.player_id)));
  }

  const candidates = (playerRows ?? []).filter(p => !withPhoto.has(String(p.id)));
  const skipped = (playerRows ?? []).length - candidates.length;

  // One name -> QID pass, then one batched wbgetentities pass for the P18 claims.
  const qids = [];
  const unresolved = [];
  for (const p of candidates) {
    const hits = (await search(p.name)).filter(h => /footballer|soccer|football player/i.test(h.description ?? ''));
    const hit = hits[0] ?? null;
    if (!hit) unresolved.push({ playerId: p.id, name: p.name, reason: 'no wikidata match' });
    else qids.push({ playerId: p.id, name: p.name, qid: hit.id });
  }

  const byQid = new Map();
  if (qids.length) {
    const resolved = await entities(qids.map(q => q.qid));
    for (const q of qids) byQid.set(q.qid, resolved[q.qid]);
  }

  const plan = [];
  for (const q of qids) {
    const [entry] = photoPlanFromEntities({ [q.qid]: byQid.get(q.qid) });
    if (!entry) { unresolved.push({ playerId: q.playerId, name: q.name, reason: 'no P18 image' }); continue; }
    plan.push({ playerId: q.playerId, wikidataId: q.qid, fileName: entry.fileName, sourceUrl: entry.sourceUrl });
  }

  return { plan, unresolved, skipped };
}

/**
 * Download each planned image, resize to 512px-wide WebP, store it under
 * `photos/{playerId}/{sha256}.webp` and write the photos row with licence,
 * attribution and source URL.
 *
 * `download`, `resize` and `licences` are injectable so tests stay offline.
 * ponytail: sequential downloads and a plain buffer sha256 - both fine at pool
 * scale; parallelise if the pool grows past a few thousand players.
 */
export async function ingestPhotos(db, {
  plan = [], storage,
  download = defaultDownload,
  resize = defaultResize,
  licences,
  fetchImpl = fetch,
} = {}) {
  const licenceMap = licences ?? await fetchLicence(plan.map(p => p.fileName), { fetchImpl });
  await upsertSource(db);

  let stored = 0, skipped = 0, fallback = 0;
  for (const item of plan) {
    let sourceUrl = item.sourceUrl;
    let info = licenceMap.get(item.fileName) ?? licenceMap.get(String(item.fileName).replace(/^File:/, ''));
    if (!info) {
      for (const [k, v] of licenceMap) {
        if (k.replace(/^File:/, '').replace(/ /g, '_') === String(item.fileName).replace(/ /g, '_')) { info = v; break; }
      }
    }
    if (!info) info = licenceFromExtMetadata(null);
    if (info.sourceUrl) sourceUrl = info.sourceUrl;

    // Disjoint outcomes: skipped = we refuse to ship this image at all,
    // fallback = we wanted it but could not get it, so the jersey tile shows.
    if (!licenceIsShippable(info) || !sourceUrl) { skipped += 1; continue; }

    let original, resized;
    try {
      original = await download(sourceUrl);
      resized = await resize(original);
    } catch {
      fallback += 1;
      continue;
    }

    const id = sha256(resized.buffer);
    const storagePath = `photos/${item.playerId}/${id}.webp`;
    try {
      await storage.upload(storagePath, resized.buffer);
    } catch {
      fallback += 1;
      continue;
    }

    await db.query(
      `insert into photos (id, player_id, storage_path, width, height, licence, attribution, source_url, source_id, is_primary)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (id) do nothing`,
      [id, item.playerId, storagePath,
        resized.width ?? info.width ?? null, resized.height ?? info.height ?? null,
        info.licence, info.attribution, sourceUrl, PHOTO_SOURCE_ID, true],
    );
    stored += 1;
  }

  return { stored, skipped, fallback };
}

async function defaultDownload(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// ponytail: no image codec here on purpose - adding a native dep (sharp) for a
// 512px resize is not worth the build cost. chromium via Playwright is already
// a dependency and does WebP natively, so the default resize goes through it.
export async function defaultResize(buffer) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const src = `data:image/*;base64,${Buffer.from(buffer).toString('base64')}`;
    const out = await page.evaluate(async ([src, width]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > width) { h = Math.round(h * width / w); w = width; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/webp', 0.85);
      const bin = atob(dataUrl.split(',')[1]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return { bytes: Array.from(bytes), width: w, height: h };
    }, [src, TARGET_WIDTH]);
    return { buffer: Uint8Array.from(out.bytes), width: out.width, height: out.height };
  } finally {
    await browser.close();
  }
}
