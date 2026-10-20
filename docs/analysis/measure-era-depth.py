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

clubs={c["club_id"]:c for c in rows("clubs.csv.gz")}
players={p["player_id"]:p for p in rows("players.csv.gz")}
club_league={cid:cl.get("domestic_competition_id") for cid,cl in clubs.items()}
BIG5={"GB1":"Premier League","ES1":"La Liga","IT1":"Serie A","FR1":"Ligue 1","L1":"Bundesliga",
      "NL1":"Eredivisie","PO1":"Primeira Liga","MLS1":"MLS","SA1":"Saudi Pro League"}

# appearances: player x competition x date x club
app_league=collections.defaultdict(set)   # pid -> {(comp, year)}
app_club=collections.defaultdict(set)     # pid -> {(comp, year, club_id)}
dates=[]
n=0
for a in rows("appearances.csv.gz"):
    n+=1
    pid=a["player_id"]; comp=a["competition_id"]; d=a.get("date") or ""
    if not pid or not comp or not d: continue
    try: yr=int(d[:4])
    except: continue
    if n==1 or len(dates)==0: pass
    dates.append(yr)
    app_league[pid].add((comp,yr))
    cl=a.get("player_club_id")
    if cl: app_club[pid].add((comp,yr,cl))
print(f"appearances rows={n}  players={len(app_league)}  date range {min(dates)}..{max(dates)}")

# transfers -> stints
stints=collections.defaultdict(set)
for t in rows("transfers.csv.gz"):
    pid=t["player_id"]; s=season_start(t.get("transfer_season"))
    if not pid or s is None: continue
    for k in ("to_club_id","from_club_id"):
        cl=t.get(k)
        if cl and club_league.get(cl): stints[pid].add((club_league[cl],s))

# combined: player -> (league, year)
combined=collections.defaultdict(set)
for pid,v in app_league.items():
    for c,y in v: combined[pid].add((c,y))
for pid,v in stints.items():
    for c,y in v: combined[pid].add((c,y))

def passes(p,pid):
    dob=p.get("date_of_birth")
    return (dob and dob>="1930-01-01" and p.get("country_of_citizenship")
            and p.get("position") not in (None,"","Missing"))

print("\n=== PLAYERS PER LEAGUE PER ERA (appearances + transfers, union) ===")
eras=[(2020,2025,"2020-25"),(2015,2019,"2015-19"),(2010,2014,"2010-14"),(2005,2009,"2005-09"),(1998,2004,"98-04")]
print(f"{'League':17}"+"".join(f"{lab:>10}" for _,_,lab in eras))
tot={}
for cid,name in BIG5.items():
    line=f"{name:17}"
    for lo,hi,lab in eras:
        c=sum(1 for pid,v in combined.items() if any(cc==cid and lo<=y<=hi for cc,y in v))
        line+=f"{c:>10}"
        tot[lab]=tot.get(lab,0)+c
    print(line)
print(f"{'ALL BIG-5':17}"+"".join(f"{tot.get(lab,0):>10}" for _,_,lab in eras))

print("\n=== SPOT CHECK: La Liga 2010-2019 ===")
la=[pid for pid,v in combined.items() if any(cc=="ES1" and 2010<=y<=2019 for cc,y in v)]
lap=[pid for pid in la if passes(players[pid],pid)]
names=sorted(players[pid]["name"] for pid in lap)
print(f"  players: {len(la)}  gate-pass: {len(lap)}")
mega=["Lionel Messi","Cristiano Ronaldo","Andres Iniesta","Xavi Hernandez","Sergio Aguero","Luis Suarez",
      "Gareth Bale","Neymar","Robert Lewandowski","Karim Benzema","Mohamed Salah","Kevin De Bruyne",
      "Eden Hazard","Luka Modric","Toni Kroos","Sergio Ramos","Iker Casillas","Zlatan Ibrahimovic",
      "David Silva","Andres Iniesta","Angel Di Maria","David Alaba","Jan Oblak"]
found=[m for m in mega if m in names]
print(f"  marquee {len(found)}/{len(mega)}: {found}")
print("  sample:", ", ".join(names[:18]))

print("\n=== SPOT CHECK: Premier League 2010-2019 ===")
gb=[pid for pid,v in combined.items() if any(cc=="GB1" and 2010<=y<=2019 for cc,y in v)]
gbp=[pid for pid in gb if passes(players[pid],pid)]
gn=sorted(players[pid]["name"] for pid in gbp)
gm=["Erling Haaland","Kevin De Bruyne","Mohamed Salah","Harry Kane","Sadio Mane","Raheem Sterling",
    "N'Golo Kante","Paul Pogba","Eden Hazard","Christian Eriksen","Sergio Aguero","David Silva"]
print(f"  players: {len(gb)}  gate-pass: {len(gbp)}")
print(f"  marquee: {[m for m in gm if m in gn]}")
print("  sample:", ", ".join(gn[:18]))

print("\n=== La Liga 2010-19 : club-path depth (how many have >=2 clubs) ===")
multi=0
for pid in lap:
    cs={c for cc,y,c in app_club.get(pid,()) if cc=="ES1" and 2010<=y<=2019}
    if len(cs)>=2: multi+=1
print(f"  players with >=2 La Liga clubs in window: {multi} ({100*multi/max(1,len(lap)):.1f}%)")
