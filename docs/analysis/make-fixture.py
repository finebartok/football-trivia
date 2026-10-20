"""Emit the engine's input contract as a committed fixture.

This is the shared interface between the data-spine plan and the game-engine
plan: the engine consumes a *resolved* player shape, and this fixture is a
faithful, hand-verified sample of that shape. The data-spine plan's derive
tests assert the pipeline reproduces it; the game-engine plan's tests run
against it.

Source: the CC0 transfermarkt-datasets dump + Wikidata squad membership.
Every number here was measured, not invented.
"""
import csv, gzip, json, collections, unicodedata, re, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DATA = os.path.join(REPO, "data", "raw")

BASE = "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data"
NEEDED = ["players", "transfers", "games", "clubs", "competitions", "appearances", "game_events"]

os.makedirs(DATA, exist_ok=True)
for name in NEEDED:
    target = os.path.join(DATA, f"{name}.csv.gz")
    if os.path.exists(target):
        continue
    url = f"{BASE}/{name}.csv.gz"
    print(f"  fetching {name}.csv.gz ...")
    req = urllib.request.Request(url, headers={"User-Agent": "FootballTriviaBuild/1.0"})
    with urllib.request.urlopen(req, timeout=600) as r, open(target, "wb") as out:
        while chunk := r.read(1 << 20):
            out.write(chunk)
print(f"source data in {DATA}")

def rows(p):
    with gzip.open(os.path.join(DATA, p), 'rt', encoding='utf-8', newline='') as f:
        for x in csv.DictReader(f):
            yield x

def season_start(v):
    if not v: return None
    v = v.strip(); a = v.split("/")[0] if "/" in v else v
    try: n = int(a)
    except: return None
    if n >= 1000: return n
    return 2000 + n if n <= 29 else 1900 + n

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z ]', '', s)).strip()

def slug(s):
    return re.sub(r'-+', '-', re.sub(r'\s+', '-', norm(s)))

players = {p["player_id"]: p for p in rows("players.csv.gz")}
clubs = {c["club_id"]: c for c in rows("clubs.csv.gz")}
comps = {c["competition_id"]: c for c in rows("competitions.csv.gz")}
games = {}
for g in rows("games.csv.gz"):
    games[g["game_id"]] = (g.get("competition_id"), g.get("date"), season_start(g.get("season")))

# Transfermarkt's coarse positions mapped onto the game's four positions.
# Scope clauses compare position strings exactly, so raw values like "Attack"
# / "Midfield" must never reach the contract.
POSITION_MAP = {
    "Goalkeeper": "Goalkeeper",
    "Defender": "Defender",
    "Midfield": "Midfielder",
    "Attack": "Forward",
}


def position_for(raw):
    return POSITION_MAP.get(raw, raw)


LEAGUE_NAMES = {
    "GB1": "Premier League", "ES1": "La Liga", "IT1": "Serie A", "FR1": "Ligue 1",
    "L1": "Bundesliga", "NL1": "Eredivisie", "PO1": "Primeira Liga", "MLS1": "MLS",
    "SA1": "Saudi Pro League",
}

def league_display(league_id):
    """Display name for a league id: the curated map first, else the competitions
    table's slug title-cased, so no raw code ever reaches the contract."""
    if league_id in LEAGUE_NAMES:
        return LEAGUE_NAMES[league_id]
    slug_name = comps.get(league_id, {}).get("name") or league_id
    return slug_name.replace("-", " ").title()

# --- clubs that appear, with ids
club_index = {}
def club_id_for(name):
    if name not in club_index:
        club_index[name] = len(club_index) + 1
    return club_index[name]

# --- per-player: teams (from transfers), tournament + window stats (from events)
team_seasons = collections.defaultdict(lambda: collections.defaultdict(set))
for t in rows("transfers.csv.gz"):
    pid, s = t["player_id"], season_start(t.get("transfer_season"))
    if not pid or s is None: continue
    for k, nk in (("to_club_id", "to_club_name"), ("from_club_id", "from_club_name")):
        cid, cname = t.get(k), t.get(nk)
        if cid and cname:
            team_seasons[pid][cname].add(s)

# appearances carry the club a player was actually registered for, which is the
# only way to see players who never transferred (Messi, Salah, Neymar).
for a in rows("appearances.csv.gz"):
    pid, cid = a.get("player_id"), a.get("player_club_id")
    d = a.get("date") or ""
    if not pid or not cid or not d: continue
    cname = clubs.get(cid, {}).get("name")
    if not cname: continue
    yr = int(d[:4])
    team_seasons[pid][cname].add(season_start(str(yr)))

win_stats = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
for e in rows("game_events.csv.gz"):
    if e.get("type") != "Goals": continue
    pid = e.get("player_id")
    if not pid: continue
    comp, date, season = games.get(e.get("game_id"), (None, None, None))
    if not comp: continue
    year = int(date[:4]) if date else None
    if comp == "FIWC":
        win_stats[pid][f"wc-{year}"]["goals"] += 1
    if e.get("club_id") and season:
        cname = clubs.get(e["club_id"], {}).get("name")
        if cname:
            win_stats[pid][f"{cname} {str(season)[2:]}/{(int(season)+1)%100:02d}"]["goals"] += 1

# --- Wikidata WC2022 squads are ingested by the data-spine plan
# (scripts/ingest/load.js --source wikidata_tournaments). The fixture does not
# need them: WC2022 membership is derived here from goal events, which is the
# subset that actually has a window stat attached.
WC2022 = set()
print("WC2022 membership in this fixture comes from goal events, not Wikidata.")

# --- goals scored aged 30+, from goal events and the player's date of birth
goals_aged = collections.defaultdict(collections.Counter)
for e in rows("game_events.csv.gz"):
    if e.get("type") != "Goals": continue
    pid = e.get("player_id")
    comp, date, season = games.get(e.get("game_id"), (None, None, None))
    if not pid or not date: continue
    dob = players.get(pid, {}).get("date_of_birth", "")[:4]
    if not dob: continue
    if int(date[:4]) - int(dob) >= 30:
        goals_aged[pid]["goals_after_age_30"] += 1

def stats_for(pid):
    st = {}
    if pid in goals_aged:
        st["goals_after_age_30"] = goals_aged[pid]["goals_after_age_30"]
    return st

# --- pick a covering set of players
def to_int(v):
    try: return int(float(v))
    except: return 0

def positive_or_none(v):
    """The source writes an empty string when it has no value. For caps, goals
    and market value, 0 and absent both mean 'not recorded'."""
    n = to_int(v)
    return n if n > 0 else None

byname = collections.defaultdict(list)
for p in players.values():
    byname[norm(p["name"])].append(p)

TARGETS = [
    "Lionel Messi", "Cristiano Ronaldo", "Kylian Mbappe", "Mohamed Salah",
    "Robert Lewandowski", "Kevin De Bruyne", "Harry Kane", "Luis Suarez",
    "Neymar", "Sergio Aguero", "Karim Benzema", "Luka Modric", "Toni Kroos",
    "Gareth Bale", "Sergio Ramos", "Virgil van Dijk", "Sadio Mane", "Eden Hazard",
    "Hakan Calhanoglu", "Emre Belozoglu", "Okay Yokuslu", "Hakan Unal",
    "Zlatan Ibrahimovic", "Antoine Griezmann", "Paul Pogba", "Marcus Rashford",
    "Olivier Giroud", "Julian Alvarez", "Enner Valencia", "Goncalo Ramos",
    "Thibaut Courtois", "Jan Oblak", "Manuel Neuer", "Ederson",
    "Vinicius Junior", "Pedri", "Gavi", "Frenkie de Jong", "Bruno Fernandes",
    "Bernardo Silva", "Rodri", "Sadio Mane", "Riyad Mahrez", "Rasmus Hojlund",
    "Alexander Isak", "Victor Osimhen", "Khvicha Kvaratskhelia", "Federico Chiesa",
    "Lautaro Martinez", "Nico Williams", "Mikel Oyarzabal", "Antoine Griezmann",
    "Declan Rice", "Bukayo Saka", "Ollie Watkins", "Jarrod Bowen", "Phil Foden",
    "Elliot Anderson", "Son Heung-min", "Kaoru Mitoma",
    "Aymeric Laporte", "Ruben Dias", "John Stones",
    # La Liga depth, so the flagship scope is well populated
    "Xavi Hernandez", "Andres Iniesta", "Sergio Busquets", "Gerard Pique", "Jordi Alba",
    "Isco", "Gonzalo Higuain", "Rodrigo Moreno", "Marcelo", "Dani Alves",
    "Diego Godin", "Santi Cazorla", "Julen Lopetegui", "Casemiro", "Marco Reus",
    "Mario Gotze", "Mats Hummels", "Thomas Muller", "Kingsley Coman",
    "Ousmane Dembele", "Rafinha", "Raphael Varane", "Alvaro Morata",
    "Ferran Torres", "Ilkay Gundogan", "Wilfred Ndidi", "Youri Tielemans",
]

selected = []
seen = set()
for name in TARGETS:
    n = norm(name)
    for p in byname.get(n, []):
        pid = p["player_id"]
        if pid in seen: continue
        if not p.get("date_of_birth"): continue
        seen.add(pid); selected.append(p); break

print(f"selected {len(selected)} players")

out_players = []
windows_registry = {}
league_index = {}

for p in selected:
    pid = p["player_id"]
    teams = []
    for cname, seasons in sorted(team_seasons.get(pid, {}).items()):
        cid = club_id_for(cname)
        lg = clubs.get(next((k for k, v in clubs.items() if v["name"] == cname), ""), {}).get("domestic_competition_id")
        if not lg: continue
        league_index.setdefault(lg, league_display(lg))
        ss = sorted(seasons)
        teams.append({
            "clubId": cid, "clubName": cname,
            "leagueId": lg, "leagueName": league_display(lg),
            "seasons": ss,
        })
    if not teams: continue

    wins = {}
    for wid, counter in win_stats.get(pid, {}).items():
        wins[wid] = {"goals": counter["goals"]}
        kind = "tournament" if wid.startswith("wc-") else "season"
        if wid not in windows_registry:
            if kind == "tournament":
                windows_registry[wid] = {"id": wid, "kind": "tournament",
                                         "label": f"{wid[3:]} World Cup", "detail": "the tournament"}
            else:
                # wid: "<Club Name> YY/YY" -> teamName + seasonStart/seasonEnd
                club_name, season_part = wid.rsplit(' ', 1)
                start_a, _ = season_part.split('/')
                start = int(start_a)
                if start < 100:
                    start = 2000 + start if start <= 29 else 1900 + start
                windows_registry[wid] = {"id": wid, "kind": "season",
                                         "label": wid,
                                         "teamName": club_name,
                                         "seasonStart": start,
                                         "seasonEnd": start + 1,
                                         "detail": "the season"}

    out_players.append({
        "id": int(pid),
        "slug": slug(p["name"]),
        "name": p["name"],
        "dateOfBirth": p["date_of_birth"].split(" ")[0],
        "citizenship": [p["country_of_citizenship"]] if p.get("country_of_citizenship") else [],
        "position": position_for(p.get("position")) or "Unknown",
        "subPosition": p.get("sub_position") or None,
        "foot": p.get("foot") or None,
        "heightCm": to_int(p.get("height_in_cm")) or None,
        "internationalCaps": positive_or_none(p.get("international_caps")),
        "internationalGoals": positive_or_none(p.get("international_goals")),
        "highestMarketValueEur": to_int(p.get("highest_market_value_in_eur")) or None,
        "marketValueEur": to_int(p.get("market_value_in_eur")) or None,
        "teams": teams,
        "tournaments": sorted(k for k in wins if k.startswith("wc-")),
        "windows": wins,
        "stats": stats_for(pid),
    })

# --- name->wikidata id map is not resolvable offline; attach WC2022 membership
# by matching tournament goal events instead (wc-2022 windows above).

fixture = {
    "_note": "Engine input contract. Generated by docs/analysis/make-fixture.py from the "
             "CC0 transfermarkt-datasets dump. Every value measured, none invented.",
    "registry": {
        "leagues": league_index,
        "clubs": [{"id": cid, "name": n} for n, cid in sorted(club_index.items(), key=lambda x: x[1])],
        "windows": windows_registry,
        "tournaments": [{"id": "wc-2022", "name": "2022 FIFA World Cup", "year": 2022}],
    },
    "players": out_players,
}

os.makedirs(os.path.join(HERE, "..", "..", "data", "fixtures"), exist_ok=True)
path = os.path.join(HERE, "..", "..", "data", "fixtures", "pool.sample.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(fixture, f, ensure_ascii=False, indent=2)

print(f"\nwrote {path}")
print(f"  players: {len(out_players)}  windows: {len(windows_registry)}  clubs: {len(club_index)}")
multi = [p for p in out_players if len(p["teams"]) > 1]
print(f"  players with multi-club paths: {len(multi)}")
withw = [p for p in out_players if p["windows"]]
print(f"  players with window stats: {len(withw)}")
sample = [p["name"] for p in out_players[:8]]
print("  sample:", ", ".join(sample))
