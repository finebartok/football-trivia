# Project Status & Technical Debt Report
**Last Updated:** 2026-09-23
**Status:** Architecture Overhauled / Data Polishing Pending

## 🚩 The Core Issue: "The Data Gap"
Despite moving to a professional Transfermarkt-based pipeline, the game still exhibits "fragile" behavior. The primary issue is a mismatch between **Data Availability** and **UI Expectations**.

### What is happening:
1.  **Null Leakage**: Players are imported into the DB, but fields like `shirtNumber` or `marketValue` are `null`. The UI renders these as `"null"` instead of hiding them or replacing them.
2.  **Data Sparsity**: Even with a professional source, not every player has a full record. When the game requires 6 clues but the player only has 3, the "filler" system isn't effectively masking the gaps.
3.  **Path Redundancy**: Career paths still occasionally show duplicate teams because of how season-by-season data is stored.

---

## 🛠️ Current Architecture (The "Drastic Change" Result)
We have moved from a fragile API $\rightarrow$ to a **Dataset Pipeline**:
- **Pipeline**: `CSV Datasets` $\rightarrow$ `scripts/import-datasets.js` $\rightarrow$ `football.db` (SQLite).
- **Server**: `server.js` now handles randomization and filtering via SQL.
- **Frontend**: `js/data.js` uses an on-demand async fetch model.
- **Difficulty**: Based on a `relevance_score` (Market Value + Appearances).

---

## 🎯 Remaining Goals & TODO List

### 1. Data Sanitization (The "Clean Room" Pass)
- [ ] **Strict Filter**: Update `import-datasets.js` to reject players who don't meet a "Minimum Quality Bar" (e.g., must have at least 3 valid clues).
- [ ] **Position Normalization**: Fine-tune the mapping of raw TM positions to the 4 game categories.
- [ ] **Career Path Compression**: Implement a more aggressive "collapse" of consecutive years at the same club in the DB layer, not just the UI.

### 2. UI/UX Robustness
- [ ] **The "Null-Proof" UI**: Create a utility function `renderClueValue(val)` that returns an empty string or a fallback instead of `"null"`.
- [ ] **Dynamic Clue Filling**: Improve `_initRoundClues` in `guess-player.js` to ensure that if a player is "data-poor," the game automatically pivots to "Easy" clues (Age, Nationality, Foot) to maintain the 6-card layout.

### 3. Difficulty Balancing
- [ ] **Tuning the Relevance Score**: Adjust the weights of the `relevance_score` calculation to better distinguish between "World Class" (Easy) and "Obscure" (Hard).
- [ ] **Distractor Logic**: Improve `getMCQOptions` to ensure distractors are challenging but not identical to the target.

---

## 📋 Summary for Future Work
**Goal**: A "Zero-Null" experience where every player feels like a curated trivia entry.
**Strategy**: Shift from "trying to fix the UI" to "ensuring only high-quality data enters the database."
**Critical Files**: 
- `scripts/import-datasets.js` (The Gatekeeper)
- `js/guess-player.js` (The Presenter)
- `server.js` (The Provider)
