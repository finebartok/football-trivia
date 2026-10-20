// Wikidata and Wikimedia Commons API clients.
//
// `searchEntity` and `getEntities` are re-exported here; this file is the only
// place that talks to Wikidata, so the whole ingest can be stubbed by swapping
// this module. Both APIs reject requests without a User-Agent, so the header is
// not optional.
const UA = 'FootballTriviaBuild/1.0 (https://github.com/dcaribou/transfermarkt-datasets)';

// --- temporary copy of the Task 9 interface, needed until task/data/9 merges ---
// searchEntity(term, limit) -> [{id,label,description}]
// getEntities(ids)          -> { QID: entity }  (50 ids per call)
export async function searchEntity(term, limit = 8) {
  const url = new URL('https://www.wikidata.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'wbsearchentities', search: term, language: 'en', limit: String(limit), format: 'json',
  });
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`wbsearchentities -> ${res.status}`);
  const json = await res.json();
  return (json.search ?? []).map(s => ({ id: s.id, label: s.label, description: s.description }));
}

export async function getEntities(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = new URL('https://www.wikidata.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'wbgetentities', ids: chunk.join('|'), props: 'claims|labels', languages: 'en', format: 'json',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`wbgetentities -> ${res.status}`);
    const json = await res.json();
    for (const [id, e] of Object.entries(json.entities ?? {})) out[id] = e;
  }
  return out;
}
// --- end temporary copy ---
