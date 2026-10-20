# Analysis scripts

Throwaway research scripts that produced the numbers cited in
`docs/superpowers/specs/2026-10-20-football-trivia-v1-design.md`.

They are **not** part of the product pipeline. Their job is to make the
spec's claims reproducible: download the CC0 Transfermarkt dump, then
measure era depth per league and apply the quality gate.

```bash
mkdir -p /tmp/tmdata && cd /tmp/tmdata
BASE=https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data
for f in players transfers games clubs competitions appearances; do
  curl -LO "$BASE/$f.csv.gz"
done
python3 <repo>/docs/analysis/measure-era-depth.py
```

`measure-era-depth.py` is the authoritative one: it unions `appearances`
(exact player x season x league) with `transfers` (dated club stints) and
applies the quality gate. The `-transfers-only` variant exists to show
why transfers alone undercount — players who never transferred are
invisible to it, which is why only 3 of 19 marquee names appeared in the
first pass.

Verified results (2026-10-20):

| League | 2020-25 | 2015-19 | 2010-14 | 2005-09 | 1998-04 |
|---|---|---|---|---|---|
| Premier League | 1,983 | 1,598 | 995 | 71 | 7 |
| La Liga | 1,778 | 1,499 | 961 | 49 | 8 |
| Serie A | 1,933 | 1,520 | 1,031 | 51 | 3 |
| Ligue 1 | 1,985 | 1,613 | 996 | 52 | 4 |
| Bundesliga | 1,717 | 1,298 | 836 | 46 | 2 |

`measure-stat-metrics.py` measures the stat metrics a Scope can filter on
(§4.7) and prints which are reachable. Key result: **"200 goals after
turning 30" is not reachable** — only 3 players clear it in the 2012+
window. The bands that hold are 30+ (285 players), 50+ (111), and
`international_caps >= 50` (1,023, and exact rather than windowed).

`measure-tournament-squads.py` resolves tournament squads from Wikidata.
The Transfermarkt dump has **World Cup 2022 fixtures but no lineups**, and
no Euro lineups at all, so WC2022 squads (~440 players) come from
Wikidata `P54` + `P1344` instead.

`measure-window-stats.py` derives per-window stats from `game_events` and
verifies them against the real record. The derived all-competition
club-season totals match exactly:

| Player | Window | Derived | Actual |
|---|---|---|---|
| Cristiano Ronaldo | Real Madrid 2014-15 | 61 | 61 |
| Lionel Messi | Barcelona 2012-13 | 60 | 60 |
| Luis Suárez | Barcelona 2015-16 | 59 | 59 |
| Robert Lewandowski | Bayern 2019-20 | 55 | 55 |
| Lionel Messi | 2022 World Cup | 7 | 7 |
| Olivier Giroud | 2022 World Cup | 4 | 4 |

That is what makes "windowed" mean *scoped* rather than *approximate* —
and it is the data behind the composed questions in §6.6.
