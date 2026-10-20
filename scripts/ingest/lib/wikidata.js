// Wikidata API clients. The only place in the ingest that talks to Wikidata, so
// the whole ingest can be stubbed by swapping this module.
//
// Both APIs reject requests without a User-Agent, so the header is not optional.
// WDQS rate-limits aggressively, so callers batch: `getEntities` takes 50 ids
// per call and a tournament squad is one SPARQL query, never one per player.
const UA = 'FootballTriviaBuild/1.0 (https://github.com/dcaribou/transfermarkt-datasets)';

export async function sparql(query) {
  const res = await fetch('https://query.wikidata.org/sparql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
    body: new URLSearchParams({ query, format: 'json' }).toString(),
  });
  if (!res.ok) throw new Error(`sparql -> ${res.status}`);
  const json = await res.json();
  return json.results?.bindings ?? [];
}

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
      action: 'wbgetentities', ids: chunk.join('|'), props: 'claims|labels',
      languages: 'en', format: 'json',
    });
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`wbgetentities -> ${res.status}`);
    const json = await res.json();
    for (const [id, e] of Object.entries(json.entities ?? {})) out[id] = e;
  }
  return out;
}

export const FOOTBALLER = 'Q937857'; // occupation (P106): association football player

/**
 * The footballers Wikidata records as participants in a tournament, or as
 * members of a participating nation's squad during its window.
 *
 * Both filters are load-bearing. Without `wdt:P106 wd:Q937857` the `P54` branch
 * also matches managers and officials; without the `pq:P580` date window it
 * matches every player who EVER turned out for a participating national team
 * (6,505 and 6,557 for the 2022 World Cup respectively, against 231 with both).
 *
 * `from`/`to` are the tournament's year and the year before it (2022 -> 2021-2022),
 * not hardcoded, so a tournament's own year drives its window.
 */
export function tournamentSquadQuery({ qid, from, to }) {
  return `
    SELECT DISTINCT ?player ?playerLabel WHERE {
      ?player wdt:P31 wd:Q5; wdt:P106 wd:${FOOTBALLER} .
      {
        ?player wdt:P1344 wd:${qid} .
      }
      UNION
      {
        ?player p:P54 ?st . ?st ps:P54 ?team .
        ?team wdt:P1344 wd:${qid} .
        ?st pq:P580 ?start .
        FILTER(YEAR(?start) >= ${from} && YEAR(?start) <= ${to})
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;
}
