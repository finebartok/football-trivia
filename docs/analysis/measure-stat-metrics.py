import csv, gzip, collections, statistics

def rows(p):
    with gzip.open(p,'rt',encoding='utf-8',newline='') as f:
        for x in csv.DictReader(f): yield x

def num(v):
    try: return int(float(v))
    except: return 0

players = {p["player_id"]: p for p in rows("players.csv.gz")}
comps = {c["competition_id"]: c for c in rows("competitions.csv.gz")}

print("=== national-team competitions in the dataset ===")
for c in comps.values():
    if c.get("type") == "national_team_competition":
        print(f"  {c['competition_id']:8} {c['name']}")

# ---- one pass over appearances
app = collections.defaultdict(lambda: {
    "goals":0, "apps":0, "minutes":0,
    "nt_goals":0, "nt_apps":0,
    "wc22_goals":0, "wc22_apps":0,
    "wc26_goals":0, "wc26_apps":0,
    "goals_after30":0, "goals_before30":0,
    "goals_since2012":0,
})
seasons = collections.Counter()
n = 0
for a in rows("appearances.csv.gz"):
    n += 1
    pid = a["player_id"]; comp = a["competition_id"]; d = a.get("date") or ""
    if not pid or not d: continue
    try: yr = int(d[:4])
    except: continue
    if yr < 2012: continue          # club coverage starts 2012/13
    g = num(a.get("goals")); ap = num(a.get("minutes_played")) and 1 or 1
    e = app[pid]
    e["goals"] += g; e["apps"] += 1; e["minutes"] += num(a.get("minutes_played"))
    e["goals_since2012"] += g
    dob = players.get(pid, {}).get("date_of_birth", "")[:4]
    age = (yr - int(dob)) if dob else None
    if age is not None:
        if age >= 30: e["goals_after30"] += g
        else: e["goals_before30"] += g
    if comp in ("FIWC","UEFAEURO","COPAAMERICA","AFCON","AFC","CONCACAFGOLD"):
        e["nt_goals"] += g; e["nt_apps"] += 1
    if comp == "FIWC":
        if 2022 <= yr <= 2022: e["wc22_goals"] += g; e["wc22_apps"] += 1
        if 2026 <= yr <= 2026: e["wc26_goals"] += g; e["wc26_apps"] += 1
print(f"\nappearances scanned: {n}")

# ---- World Cup 2022
wc22 = [pid for pid,e in app.items() if e["wc22_apps"] > 0]
wc22_scorers = [pid for pid,e in app.items() if e["wc22_goals"] > 0]
wc26 = [pid for pid,e in app.items() if e["wc26_apps"] > 0]
print(f"\n=== WORLD CUP ===")
print(f"  WC2022 players with an appearance : {len(wc22)}")
print(f"  WC2022 players who scored          : {len(wc22_scorers)}")
print(f"  WC2026 players with an appearance   : {len(wc26)}")
names = sorted(players[p]["name"] for p in wc22_scorers)
print("  WC2022 scorers sample:", ", ".join(names[:18]))
for star in ["Lionel Messi","Kylian Mbappe","Julián Álvarez","Olivier Giroud","Marcus Rashford","Enner Valencia"]:
    hit = [p for p in wc22 if players[p]["name"] == star]
    if hit:
        e = app[hit[0]]
        print(f"    {star:18} apps={e['wc22_apps']:2} goals={e['wc22_goals']}")

# ---- goals after 30
print("\n=== 'goals after turning 30' (window = 2012+) ===")
after30 = sorted((e["goals_after30"] for e in app.values()), reverse=True)
print("  top 12 values:", after30[:12])
for thresh in (100, 50, 30, 20, 10):
    cnt = sum(1 for v in after30 if v >= thresh)
    print(f"  players with >= {thresh:3} goals aged 30+ : {cnt}")
gt200 = [pid for pid,e in app.items() if e["goals_after30"] >= 200]
print(f"  players with >= 200 goals aged 30+ : {len(gt200)}")
print("  -> the user's '200 goals after 30' example is NOT reachable in this window")

# ---- what IS a good stat scope threshold?
print("\n=== stat-scope feasibility (goals aged 30+, windowed) ===")
for lo,hi in [(30,60),(60,100),(100,150),(150,250),(250,400),(400,9999)]:
    cnt = sum(1 for e in app.values() if lo <= e["goals_after30"] < hi)
    print(f"  {lo:4}-{hi:<5} : {cnt}")

# ---- club goals in covered window
print("\n=== 'scored N goals' with NO age condition (window 2012+) ===")
tot = sorted((e["goals_since2012"] for e in app.values()), reverse=True)
print("  top 12:", tot[:12])
for thresh in (300,200,150,100,50):
    print(f"  players with >= {thresh:3} goals since 2012 : {sum(1 for v in tot if v>=thresh)}")

# ---- players with appearances but zero goals (for numeric-distractor realism)
z = sum(1 for e in app.values() if e["apps"] > 0 and e["goals_since2012"] == 0)
print(f"\n  players with appearances but 0 goals since 2012: {z} (useful as MCQ distractors)")

# ---- national team caps (exact, from players table, NOT windowed)
caps = [num(players[p].get("international_caps")) for p in players]
print(f"\n=== international caps (exact career value, not windowed) ===")
print("  players with caps>0:", sum(1 for c in caps if c>0), "| with caps>=50:", sum(1 for c in caps if c>=50))
