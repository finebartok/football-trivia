import csv, gzip, collections

def rows(p):
    with gzip.open(p,'rt',encoding='utf-8',newline='') as f:
        for x in csv.DictReader(f): yield x

def season_start(v):
    """'25/26' -> 2025 ; '2015/2016' -> 2015 ; '2020' -> 2020"""
    if not v: return None
    v = v.strip()
    if "/" in v:
        a = v.split("/")[0]
    else:
        a = v
    try: n = int(a)
    except: return None
    if n >= 1000: return n
    # TM convention: '25/26'->2025, '99/00'->1999, '00/01'->2000
    return 2000 + n if n <= 29 else 1900 + n

def num(v):
    try: return int(float(v))
    except: return None

comps = {c["competition_id"]: c for c in rows("competitions.csv.gz")}
clubs = {c["club_id"]: c for c in rows("clubs.csv.gz")}
players = {p["player_id"]: p for p in rows("players.csv.gz")}
club_league = {cid: cl.get("domestic_competition_id") for cid, cl in clubs.items()}

BIG5 = {"GB1":"Premier League","ES1":"La Liga","IT1":"Serie A","FR1":"Ligue 1","L1":"Bundesliga",
        "NL1":"Eredivisie","PO1":"Primeira Liga","MLS1":"MLS","SA1":"Saudi Pro League"}

stints = collections.defaultdict(set)   # player_id -> {(comp, season)}
n_tr = 0; bad_season = 0
for t in rows("transfers.csv.gz"):
    n_tr += 1
    pid = t["player_id"]; s = season_start(t.get("transfer_season"))
    if not pid or s is None:
        bad_season += 1; continue
    for k in ("to_club_id","from_club_id"):
        cl = t.get(k)
        if not cl: continue
        lg = club_league.get(cl)
        if lg: stints[pid].add((lg, s))

print(f"transfers={n_tr}  unparseable_season={bad_season}  players_with_stint={len(stints)}")
seasons = sorted({s for v in stints.values() for _,s in v})
print(f"season range: {seasons[0]} .. {seasons[-1]}")

print("\n=== PLAYERS WITH A STINT PER LEAGUE PER ERA ===")
eras = [(2016,2025,"2016-25"),(2010,2019,"2010-19"),(2005,2009,"2005-09"),(2000,2004,"2000-04"),(1995,1999,"1995-99")]
for cid,name in BIG5.items():
    if cid not in comps: print(f"{name}: league code absent"); continue
    line = f"{name:16}"
    for lo,hi,lab in eras:
        cnt = sum(1 for pid,s in stints.items() if any(c==cid and lo<=sn<=hi for c,sn in s))
        line += f"  {lab}={cnt:<6}"
    print(line)

def passes(p, pid):
    dob = p.get("date_of_birth")
    return (dob and dob >= "1930-01-01"
            and p.get("country_of_citizenship")
            and p.get("position") not in (None,"","Missing")
            and stints.get(pid))
passers = [pid for pid,p in players.items() if passes(p,pid)]
print(f"\n=== QUALITY GATE ===")
print(f"  total players          {len(players)}")
print(f"  gate pass (G1-G5)      {len(passers)}")
caps = sum(1 for pid in passers if num(players[pid].get("international_caps")))
mv   = sum(1 for pid in passers if num(players[pid].get("market_value_in_eur")))
img  = sum(1 for pid in passers if players[pid].get("image_url"))
print(f"    caps>0                {caps} ({100*caps/max(1,len(passers)):.1f}%)")
print(f"    market_value          {mv} ({100*mv/max(1,len(passers)):.1f}%)")
print(f"    TM image_url          {img} ({100*img/max(1,len(passers)):.1f}%)")

print("\n=== SPOT CHECK: 'La Liga 2010-2019' ===")
la = "ES1"
la_set = [pid for pid,s in stints.items() if any(c==la and 2010<=sn<=2019 for c,sn in s)]
la_pass = [pid for pid in la_set if passes(players[pid],pid)]
names = sorted(players[pid]["name"] for pid in la_pass)
print(f"  players with a La Liga stint 2010-19: {len(la_set)}   (passing gate: {len(la_pass)})")
print("  sample:", ", ".join(names[:25]))
mega = ["Lionel Messi","Cristiano Ronaldo","Andres Iniesta","Xavi Hernandez","Sergio Aguero","Luis Suarez",
        "Gareth Bale","Neymar","Robert Lewandowski","Karim Benzema","Mohamed Salah","Kevin De Bruyne",
        "Eden Hazard","Luka Modric","Toni Kroos","Sergio Ramos","Casillas","Thiago Alcantara","Zlatan Ibrahimovic"]
found = [m for m in mega if m in names]
print("  marquee names present:", found)
print(f"  ({len(found)}/{len(mega)} of the marquee list)")

print("\n=== SPOT CHECK: 'Premier League 2010-2019' ===")
gb = [pid for pid,s in stints.items() if any(c=="GB1" and 2010<=sn<=2019 for c,sn in s)]
gb_pass = [pid for pid in gb if passes(players[pid],pid)]
print(f"  players with a PL stint 2010-19: {len(gb)}  (passing gate: {len(gb_pass)})")

print("\n=== SPOT CHECK: current PL 2024-25 (what works today) ===")
gb2 = [pid for pid,s in stints.items() if any(c=="GB1" and 2024<=sn<=2025 for c,sn in s)]
gb2p = [pid for pid in gb2 if passes(players[pid],pid)]
print(f"  players with a PL stint 2024-25: {len(gb2)}  (passing gate: {len(gb2p)})")
