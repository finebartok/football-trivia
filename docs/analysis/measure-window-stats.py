import csv, gzip, collections

def rows(p):
    with gzip.open(p,'rt',encoding='utf-8',newline='') as f:
        for x in csv.DictReader(f): yield x

def season_start(v):
    if not v: return None
    v=v.strip(); a=v.split("/")[0] if "/" in v else v
    try: n=int(a)
    except: return None
    if n>=1000: return n
    return 2000+n if n<=29 else 1900+n

games = {}
for r in rows("games.csv.gz"):
    games[r["game_id"]] = (r.get("competition_id"), r.get("date"), r.get("season"),
                           r.get("home_club_id"), r.get("away_club_id"))
players = {p["player_id"]: p for p in rows("players.csv.gz")}
clubs = {c["club_id"]: c for c in rows("clubs.csv.gz")}

# ---- goals from events
wc22_goals = collections.Counter()
season_goals = collections.Counter()      # (player_id, competition, season)
club_goals = collections.Counter()        # (player_id, club_id, season)
all_goals = collections.Counter()
year_span = collections.Counter()
unresolved = 0
n = 0
for e in rows("game_events.csv.gz"):
    if e.get("type") != "Goals": continue
    n += 1
    pid = e.get("player_id")
    if not pid: continue
    comp, date, season, h, a = games.get(e.get("game_id"), (None, None, None, None, None))
    if not comp: continue
    if pid not in players: unresolved += 1
    else: all_goals[pid] += 1
    yr = int(date[:4]) if date else None
    if comp == "FIWC" and yr == 2022: wc22_goals[pid] += 1
    ss = season_start(season) if season else yr
    if ss:
        season_goals[(pid, comp, ss)] += 1
        cid = e.get("club_id")
        if cid: club_goals[(pid, cid, ss)] += 1
    if yr: year_span[yr] += 1

print(f"goal events: {n}  player_ids not in players.csv: {unresolved}")
print(f"distinct scorers: {len(all_goals)}")

print("\n=== WORLD CUP 2022 top scorers (derived from game_events) ===")
for pid, g in wc22_goals.most_common(12):
    nm = players.get(pid, {}).get("name", "?")
    print(f"  {nm:24} {g} goals")
known = {"Kylian Mbappe":8, "Lionel Messi":7, "Julian Alvarez":4, "Olivier Giroud":4,
         "Marcus Rashford":3, "Enner Valencia":3, "Goncalo Ramos":3}
print("\n  expected (real WC2022): Mbappe 8, Messi 7, Alvarez 4, Giroud 4, Rashford 3, Valencia 3, Ramos 3")
for k, v in known.items():
    hit = [p for p in wc22_goals if players.get(p, {}).get("name") == k]
    got = wc22_goals.get(hit[0], 0) if hit else None
    print(f"    {k:16} expected {v}  derived {got}  {'OK' if got == v else 'MISMATCH'}")

print("\n=== club goals per SEASON (from events) — how far back? ===")
yrs = sorted(year_span)
print("  goal-event years:", yrs[0], "..", yrs[-1])
per_season = collections.defaultdict(set)
for (pid, comp, ss), g in season_goals.items():
    if comp and comp not in ("FIWC","EURO","COPA","AFCN","AFAC","AFAC"):
        per_season[ss].add(pid)
ks = sorted(per_season)
for y in ks:
    if y % 4 == 0 or y >= 2022:
        print(f"    {y}: {len(per_season[y])} players scored")

print("\n=== multi-season scorers: how many players have goals in >=5 distinct seasons? ===")
seasons_per_player = collections.defaultdict(set)
for (pid, comp, ss), g in season_goals.items():
    seasons_per_player[pid].add(ss)
hist = collections.Counter(len(v) for v in seasons_per_player.values())
for k in sorted(hist):
    if k >= 3: print(f"    {k} seasons: {hist[k]} players")
print("  players with goals in >=5 seasons:", sum(v for k, v in hist.items() if k >= 5))
print("  players with goals in >=10 seasons:", sum(v for k, v in hist.items() if k >= 10))

print("\n=== club-season goals: candidates for 'scored N goals for X in season Y' ===")
multi_club = collections.Counter()
for (pid, cid, ss), g in club_goals.items():
    if g >= 5: multi_club[pid] += 1
print("  players with >=5 goals in a single club-season:", len(multi_club))
print("  players with >=10 goals in a single club-season:", sum(1 for p,c in multi_club.items() if c>=1))
big = sorted(((g,(pid,cid,ss)) for (pid,cid,ss),g in club_goals.items() if g>=20), reverse=True)[:10]
print("  top club-season goal hauls:")
for g,(pid,cid,ss) in big:
    nm = players.get(pid,{}).get("name","?"); cn = clubs.get(cid,{}).get("name","?")
    print(f"    {nm:22} {cn:22} {ss}/{str(ss)[2:]}  {g} goals")

print("\n=== cards (yellow/red) as a windowed stat? ===")
print("  (skipped - Cards events exist but need player+match correlation for totals)")
