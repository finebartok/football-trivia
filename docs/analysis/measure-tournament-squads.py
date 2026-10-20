import json, urllib.parse, urllib.request, collections

UA = {"User-Agent": "FootballTriviaBuild/1.0", "Accept": "application/sparql-results+json"}

def sparql(q):
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def search(term):
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
        "action": "wbsearchentities", "search": term, "language": "en", "limit": "4", "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA["User-Agent"]})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["search"]

TOURNAMENTS = [
    ("FIFA World Cup 2014", "2014 FIFA World Cup"),
    ("FIFA World Cup 2018", "2018 FIFA World Cup"),
    ("FIFA World Cup 2022", "2022 FIFA World Cup"),
    ("FIFA World Cup 2026", "2026 FIFA World Cup"),
    ("UEFA Euro 2020", "UEFA Euro 2020"),
    ("UEFA Euro 2024", "UEFA Euro 2024"),
    ("Copa America 2024", "2024 Copa America"),
]

QID = {}
for label, term in TOURNAMENTS:
    try:
        res = search(term)
        for s in res:
            if label.lower() in (s.get("label","").lower()):
                QID[label] = s["id"]; break
        else:
            if res: QID[label] = res[0]["id"]
    except Exception as e:
        print(f"  search failed for {term}: {e}")

print("=== resolved QIDs ===")
for k, v in QID.items():
    print(f"  {k:24} {v}")

UNION_Q = """
SELECT (COUNT(DISTINCT ?player) AS ?n) WHERE {
  { ?player wdt:P1344 wd:%s . }
  UNION
  { ?player p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P1344 wd:%s .
    OPTIONAL { ?st pq:P580 ?s } OPTIONAL { ?st pq:P582 ?e }
    FILTER(!BOUND(?s) || (YEAR(?s) <= 2022 && YEAR(?s) >= 2013))
  }
}"""

print("\n=== squad size per tournament (Wikidata, union of both paths) ===")
rows = []
for label, qid in QID.items():
    try:
        d = sparql(UNION_Q % (qid, qid))
        n = int(d["results"]["bindings"][0]["n"]["value"])
    except Exception as e:
        n = f"err"
    rows.append((label, qid, n))
    print(f"  {label:24} {qid:12} {n}")

# sample names for the biggest
def sample(qid, limit=10):
    q = f'SELECT ?pLabel WHERE {{ {{ ?p wdt:P1344 wd:{qid} . }} UNION {{ ?p p:P54 ?st . ?st ps:P54 ?team . ?team wdt:P1344 wd:{qid} . }} SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }} }} LIMIT {limit}'
    d = sparql(q)
    return [b["pLabel"]["value"] for b in d["results"]["bindings"] if "pLabel" in b]

print("\n=== WC2022 sample ===")
print("  ", ", ".join(sample(QID.get("FIFA World Cup 2022",""), 14)))
print("\n=== Euro 2024 sample ===")
print("  ", ", ".join(sample(QID.get("UEFA Euro 2024",""), 14)))
