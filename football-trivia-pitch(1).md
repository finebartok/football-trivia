# Personalized Football Trivia — Concept Pitch

**One-liner:** A football trivia app built around "Scopes" instead of quizzes. You and your friends define who you are as fans — a decade of La Liga, this World Cup's squads, your local league — save it once, and play any game mode against it. It's not a filter tool. It's the version of a friend-group trivia night that nobody has to build by hand, because it's generated from real, live football data instead of someone's Thursday-afternoon typing.

---

## 1. The Problem

Football fans don't consume the sport uniformly. A friend group might have followed La Liga intensely from 2010–2019 and then drifted toward the Premier League — so when they sit down to play trivia, they don't want "La Liga trivia" or "Premier League trivia" as two separate, generic buckets. They want a pool that reflects *how they actually followed the sport*: a blend of their La Liga era and their current league, or "only players from this World Cup's squads," or "just our local league tonight."

Every existing trivia product forces a choice the fans don't actually want to make:

- **Static, pre-authored quizzes** (Sporcle-style): huge in volume, but every quiz was typed out by a human in advance. Nobody has authored "our specific mash-up," and nobody will, because it's too narrow to be worth a stranger's time to write.
- **Live-database-driven but locked-format games** (Immaculate Grid / Immaculate Footy): the data is real and current, but the categories are chosen once a day by the platform's team, for everyone. There's no way to make it *yours*.
- **Group trivia platforms** (Kahoot, Jackbox): genuinely social and built for groups, but customization means a host manually builds the quiz before the party — real, documented friction that most hosts don't have time for.

The gap: nobody lets a friend group define *which players are in play* for their session — blending eras, leagues, teams, or tournaments the way they actually think about the sport — and then plays multiple game formats against that pool.

---

## 2. The Solution: "Scopes"

The core unit of the product isn't a question or a quiz — it's a **Scope**: a saved, named definition of which players are eligible to appear, built by combining a small number of dials:

- **Era** (e.g., La Liga 2010–2019)
- **League(s)** (can combine more than one — e.g., that era of La Liga *plus* current Premier League)
- **Team(s)** (e.g., your local club, or two rivals for a derby session)
- **Tournament roster** (e.g., "players who featured in the last World Cup" — used as a pool definition, not a topic)
- **Nationality**

Critically, combining these is often a **union**, not an intersection: "La Liga 2010s players *or* current Premier League players," not "players who satisfy both." This matters for two reasons:

1. It matches how fans actually think and talk about their own fandom.
2. It's technically safer than deep boolean filtering — union-based pools rarely collapse to zero or one valid answer the way narrow intersections can (e.g., "Italian AND Milan AND Juventus AND that decade" might return two players; blending two eras or leagues almost never does).

Once a Scope exists, it's reusable and reshuffle-able. Any game format — multiple choice, gradual-reveal "guess the player," a criteria grid, a ranking challenge, a higher/lower stat battle — draws its questions from whatever Scope is active. Build the Scope once, like a Spotify playlist or an FPL squad; replay it for months.

---

## 3. What Makes This Different (Competitive Landscape)

| Product | What it does | The gap it leaves |
|---|---|---|
| **Sporcle** | 2M+ user-made quizzes, 10 formats, played 6B+ times | All content is manually authored — no live database, no way to blend two static quizzes into one pool |
| **Immaculate Grid / Immaculate Footy** (Sports Reference / FBref) | Live-database daily grid trivia; rarity scores; genuinely popular, acquired and scaled fast | One format (grid), one global puzzle a day — categories are set by the platform, not the user or a friend group |
| **Kahoot / Jackbox** | Massive, proven group-trivia audience (Kahoot: 1B+ players/year, 200+ countries) | Customization exists but requires manual quiz-building by a host each time — a known, stated pain point |
| **Stathead** (Sports Reference) | Real query-builder against deep historical stats, $8/mo | Built for research/power users, not a game — no gamified formats, no group/social layer |
| **FPL (Fantasy Premier League)** | 8–12M+ users; personalized, ongoing, friend-group engagement with real player data | Not trivia — it's squad management, but proves football fans want exactly this *kind* of personalized, social, recurring engagement |
| **"Guess the player" apps** (many) | Proven gradual-reveal mechanic | Fixed, pre-curated player sets — no personalization to a specific group's era or league focus |

**The uncrowded quadrant:** live database **+** user-composed scope **+** multiple output formats **+** friend-group orientation. Nobody in this landscape combines all four.

---

## 4. Core Product Features

### MVP
- Scope builder: a handful of opinionated dials (era slider, league toggles, team picker, tournament-roster toggle), not an open-ended query console
- 2 game formats to start (recommend: gradual-reveal "guess the player" + criteria grid — both are proven mechanics elsewhere, so the risk is concentrated in the Scope layer, not the format layer)
- Save & name a Scope; reuse it across sessions
- Invite friends into an existing Scope with zero setup on their end — they tap a link and play

### V2 and beyond
- **Natural-language scope creation** — type or say "2010s La Liga mixed with current Prem," parsed automatically. Removes the "form-filling" feel entirely.
- **Contextual auto-suggested Scopes** — the app proactively offers "play with this tournament's squads," "derby week," "new season kickoff" without the user assembling anything.
- **Remix** — fork a friend's Scope with one tweak instead of starting blank.
- **Shareable identity card** (Wrapped-style) — a season-end or monthly auto-generated card summarizing a group's fan identity ("70% La Liga 2010s, 30% current Prem"). This is the primary *discovery* mechanic — legible to people outside the group, unlike the Scope itself.
- **Rarity / percentile stats** on answers, borrowed from Immaculate Grid — shows what % of your group (or the wider platform) got a question right.
- **Weekly official Scope** everyone on the platform can play, alongside private group Scopes — preserves the "we all had the same puzzle" viral magic that fully custom content would otherwise lose.
- **Scoped Higher/Lower** — a proven, addictive, streamer-friendly format, made fresh by running it against a group's specific Scope instead of a generic global pool.
- **"Build your XI from this Scope"** — a lightweight fantasy-adjacent format (budget/formation constraint, compare picks with friends), bridging directly into FPL's proven appetite.

---

## 5. Market Feasibility

**Demand signals are strong:**
- Group trivia is a mainstream, proven behavior at massive scale — Kahoot alone reports over a billion players a year across 200+ countries.
- Football fans specifically already embrace personalized, ongoing, data-driven engagement with friends — Fantasy Premier League has over 8 million registered users, with some projections putting it on track past 12 million.
- The specific pain point this product solves is already named in the group-trivia market: custom, group-built quizzes are recognized as beating pre-packaged trivia, but today require a host to manually build them in advance. Removing that manual-authoring step by generating content from real data is a structural fix to a documented friction point, not a made-up one.
- Football is the most globally followed sport by a wide margin, giving the category a large top-of-funnel even before any product-specific traction.

**Caveat on market sizing:** general "trivia games market" figures from industry reports vary wildly — anywhere from roughly $300M to $3–4B depending on whether board games, corporate training, and education platforms are bundled in. Treat any single quoted TAM number skeptically; the directional signal (large, growing, monetizable) is reliable, the precise figure is not.

---

## 6. Attraction & Go-to-Market

**Market size ≠ attraction.** Stathead has the ideal audience and has run since 2020 as a niche subscription most casual fans have never heard of — proof that a good product in a large market doesn't guarantee discovery.

**What actually spreads in this category** is content that's legible to someone outside the group: a Wordle-style score, a rarity percentage, a clip. A custom Scope by itself ("our 2010s La Liga + current Prem mix") means nothing to a stranger — it's a **retention** mechanic, not a **discovery** mechanic. The shareable identity card is what needs to carry discovery; the Scope mechanic alone won't.

**The native growth lever worth designing around:** because the natural unit here is a group, not a solo player, every Scope built is a built-in invite opportunity — similar to Kahoot's host-brings-players loop or FPL's mini-leagues. This only works if *joining* a Scope is frictionless (tap a link, just play) even though *building* one takes a little more effort.

**Timing, checked against the actual football calendar:**
- The 2026 World Cup already concluded (Spain won the final on July 19, 2026) — that hook has passed and won't recur at that scale until Euro 2028 or the 2030 World Cup.
- A much stronger and *recurring* hook is imminent: La Liga kicks off August 14, 2026, the Premier League the weekend of August 21–22, and the Bundesliga August 28 — domestic new-season kickoff is when fan attention resets every year, and it's the same moment FPL sees its largest annual traffic spike. This is a better anchor for a launch or content push than trying to catch the tail of a tournament that's already over.

**Expected shape of growth:** plan for something closer to Stathead's slow, word-of-mouth, community-seeded curve than Wordle's overnight viral spike. The core appeal — deep personalization to a specific group's football history — is a smaller top-of-funnel than a frictionless, universal format like Kahoot or Higher/Lower. That's a viable business shape, but it should set expectations for funding, patience, and whether early paid acquisition even makes sense.

---

## 7. Pros

- Content scales without human authors — the database generates the long tail; no one has to write out "Italians at Milan and Juve, 1998–2008" by hand.
- Serves fans existing products can't — hyper-specific nostalgia queries are exactly what a search box can't pre-author but a filter can produce trivially.
- Format-agnostic engine — once the Scope layer exists, new game modes are cheap to add; the expensive part is built once.
- Rides an already-validated football-fan behavior (FPL) rather than inventing a new appetite.
- Union-based blending is lower-risk than deep intersection — the "zero valid answers" failure mode is much less likely.
- Retention hook via saved group identity — a named, reused Scope is a much stickier reason to return than a random daily puzzle.

## 8. Cons & Risks

- **Setup-friction risk (the core product risk):** if building a Scope feels like filling out a form rather than drafting a fantasy squad, most sessions will default to "just play everything" and the personalization layer goes unused — effort spent building it becomes over-engineering in practice, even though the underlying idea is sound.
- **Data depth and cost:** era-accurate historical squad data (not just current rosters) is the harder, more expensive kind of football data to source and maintain; scraping sites like Transfermarkt breaches their terms of service, and professional-grade data (Opta, StatsBomb) is costly.
- **Incumbent risk:** Sports Reference already owns the deepest football data infrastructure (via FBref) and an engaged daily-trivia audience through Immaculate Footy. If they ever let users set their own grid categories, a meaningful chunk of this product's differentiation could disappear quickly, on top of data infrastructure that took them years to build.
- **Discovery is a separate problem from the core mechanic** — Scopes alone don't spread; a legible, shareable artifact (the identity card) has to be designed and built specifically to carry outside-the-group discovery.
- **Niche-vs-mass-market tension:** the personalization appeal is real but inherently narrower than frictionless, universal trivia formats — this likely means slower, community-driven growth rather than viral spikes.

---

## 9. Honest Verdict: Entertaining, or Over-Engineered?

The underlying insight is sound, not over-engineered: matching content to what a specific group actually knows and cares about is a real, felt problem — generic trivia is either too easy or humiliatingly hard for any given fan group, and FPL already proves football fans want personalized, ongoing, friend-group engagement with real data.

The over-engineering risk lives entirely in implementation, and there's a concrete test for it: **would this group build a Scope once and replay it ten times, or want something different every session?**

- If it's "build once, reuse for months" — the effort of a good setup flow is justified, the same way people happily spend time drafting a fantasy team.
- If it's "we want something new every week," setup needs to be near-instant (one tap, a preset, a suggested Scope) or it will go unused.

**Recommended cheap validation before building further:** manually curate one Scope by hand (a spreadsheet of "our La Liga 2010s + current Prem" players) and run an actual quiz night with existing free tools. If it's noticeably better than generic trivia for the group, the core hypothesis is validated for the cost of an afternoon. A further, low-cost test: post that manually-built concept in a couple of football communities (a team subreddit, a football Discord) and see whether strangers ask for their own version — real attraction signal before any Scope-engine code gets written.

---

## 10. Recommended Next Steps

1. Run the manual Wizard-of-Oz validation above with your own friend group.
2. If validated, scope an MVP to **one or two formats** and a **small set of preset dials** — not a fully general filter composer.
3. Target the new-season window (mid-to-late August) as a natural, recurring launch/content moment rather than chasing a tournament that's already passed.
4. Design the shareable identity card early — it's the discovery mechanic, not an afterthought.
5. Plan for slow, community-driven growth rather than a viral launch; validate willingness to pay (or ad tolerance) with a small group before investing in data licensing at scale.

---

### Sources referenced in this analysis
- sports-reference.com/immaculate-footy — Immaculate Footy game mechanics and data sourcing
- en.wikipedia.org/wiki/Immaculate_Grid — Immaculate Grid history and acquisition timeline
- en.wikipedia.org/wiki/Sporcle — Sporcle scale and format variety
- sports-reference.com/stathead — Stathead pricing and query-tool functionality
- kahoot.com/home/mobile-app — Kahoot's stated player/country reach
- weekend.com/post/games-like-jackbox — the "custom beats pre-packaged, but requires manual build" observation
- en.wikipedia.org/wiki/2026_FIFA_World_Cup — 2026 World Cup dates and outcome
- sports.yahoo.com — 2026–27 domestic league start dates
