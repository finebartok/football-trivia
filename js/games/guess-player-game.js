import { shuffleArray, getAge, getAgeRange, getFlag, randomFromArray, fuzzyMatch } from '../utils.js';

export class GuessPlayerGame {
  constructor(playerPool, options = {}) {
    if (!playerPool || playerPool.length < 10) {
      throw new Error("Player pool must contain at least 10 players");
    }
    this.difficulty = options.difficulty || 'medium'; // 'easy' | 'medium' | 'hard'

    let filteredPool = [...playerPool];
    if (this.difficulty === 'easy') {
      const ELITE_TEAMS = [
        "Real Madrid", "FC Barcelona", "Barcelona", "Manchester City", "Man City", "Arsenal",
        "Liverpool", "Manchester United", "Man Utd", "Chelsea", "Tottenham Hotspur", "Spurs",
        "Bayern Munich", "Bayern", "Borussia Dortmund", "Dortmund", "Bayer Leverkusen",
        "Paris Saint-Germain", "PSG", "Juventus", "AC Milan", "Inter Milan", "Inter",
        "Atletico Madrid", "Napoli", "Roma", "Aston Villa", "Newcastle United", "Ajax", "Benfica", "Porto"
      ];
      filteredPool = filteredPool.filter(p =>
        (p.teams || []).some(t => ELITE_TEAMS.includes(t.team))
      );
    } else if (this.difficulty === 'medium') {
      // Medium: Mix of elite and known players (using fame/market value as proxy)
      filteredPool = filteredPool.filter(p => {
        const isElite = (p.teams || []).some(t => [
          "Real Madrid", "FC Barcelona", "Barcelona", "Manchester City", "Man City", "Arsenal",
          "Liverpool", "Manchester United", "Man Utd", "Chelsea", "Tottenham Hotspur", "Spurs",
          "Bayern Munich", "Bayern", "Borussia Dortmund", "Dortmund", "Bayer Leverkusen",
          "Paris Saint-Germain", "PSG", "Juventus", "AC Milan", "Inter Milan", "Inter",
          "Atletico Madrid", "Napoli", "Roma", "Aston Villa", "Newcastle United"
        ].includes(t.team));
        const isHighValue = p.marketValue && parseInt(p.marketValue) > 30;
        return isElite || isHighValue;
      });
    }

    if (filteredPool.length < 10) {
      filteredPool = [...playerPool]; // Fallback if too few elite players
    }

    this.playerPool = shuffleArray(filteredPool);
    this.targetPlayers = this.playerPool.slice(0, 10);
    this._currentRound = 1;
    this._score = 0;
    this.roundsData = [];
    this._currentCluesRevealed = 0;
    this._currentMCQOptions = null;

    this._initRoundClues();
  }

  get currentRound() { return this._currentRound; }
  get totalRounds() { return 10; }
  get currentScore() { return this._score; }
  get isGameOver() { return this._currentRound > 10; }
  get currentPlayer() { return this.targetPlayers[this._currentRound - 1]; }

  get revealedClues() {
    const p = this.currentPlayer;
    if (!p) return [];
    const allClues = this._generateClues(p);
    return allClues.slice(0, this._currentCluesRevealed);
  }

  get maxClues() {
    return 6;
  }

  get cluesRemaining() {
    return this.maxClues - this._currentCluesRevealed;
  }

  get maxPossibleScore() {
    return Math.max(1, 6 - this._currentCluesRevealed);
  }

  _initRoundClues() {
    const player = this.currentPlayer;
    if (!player) return;

    const flag = getFlag ? getFlag(player.nationality) : '🏳️';
    const age = getAge ? getAge(player.dateOfBirth) : 25;
    const foot = player.preferredFoot || 'Right';
    const shirt = player.shirtNumber ? `#${player.shirtNumber}` : null;
    const val = player.marketValue ? `€${player.marketValue}M` : null;

    // Transfer path
    let teamPath = 'Top 5 League Club';
    if (player.teams && player.teams.length > 0) {
      const pathArray = player.teams
        .map(t => t.team)
        .filter(Boolean)
        .filter((team, index, self) => self.indexOf(team) === index); // Remove consecutive duplicates
      if (pathArray.length > 0) {
        teamPath = pathArray.join(' ➡️ ');
      }
    }

    // Trophies / Honors string
    const trophyStr = (player.trophies && player.trophies.length > 0)
      ? player.trophies.slice(0, 3).join(', ')
      : 'Domestic Title Winner';

    const allPossibleClues = [
      { id: 'nat', label: "Nationality", value: player.nationality, iconKey: "nat" },
      { id: 'pos', label: "Position & Foot", value: `${player.position} (${foot}-footed)`, iconKey: "pos" },
      { id: 'path', label: "Career Clubs Route", value: teamPath, iconKey: "path" },
      { id: 'shirt', label: "Shirt Number", value: shirt ? `Jersey ${shirt}` : null, iconKey: "shirt", required: !!shirt },
      { id: 'honors', label: "Major Honors", value: trophyStr, iconKey: "honors" },
      { id: 'value', label: "Peak Market Value", value: val ? `Value: ${val}` : null, iconKey: "value", required: !!val }
    ];


    // Filter out clues that are null or "N/A" and fill with alternatives if needed
    this._roundClues = allPossibleClues.filter(clue => clue.value != null);

    // If we have too few clues, we'll add generic ones to maintain game balance
    if (this._roundClues.length < 6) {
      const fillers = [
        { id: 'age', label: "Age", value: `Age: ${age}`, iconKey: "age" },
        { id: 'foot', label: "Preferred Foot", value: `${foot}-footed`, iconKey: "pos" }
      ];

      this._roundClues.push(...fillers);
    }

    this._roundClues = shuffleArray(this._roundClues.slice(0, 6));
    this._revealedIndices = new Set();
  }

  revealRandomClue() {
    const availableIndices = [];
    for (let i = 0; i < this._roundClues.length; i++) {
      if (!this._revealedIndices.has(i)) {
        availableIndices.push(i);
      }
    }

    if (availableIndices.length === 0) return null;

    const randomIndex = randomFromArray(availableIndices);
    this._revealedIndices.add(randomIndex);
    this._currentCluesRevealed++;

    return {
      index: randomIndex,
      clue: this._roundClues[randomIndex]
    };
  }

  revealClueAtIndex(index) {
    if (index < 0 || index >= this._roundClues.length) return null;
    if (this._revealedIndices.has(index)) return { index, clue: this._roundClues[index] };

    this._revealedIndices.add(index);
    this._currentCluesRevealed++;

    return {
      index: index,
      clue: this._roundClues[index]
    };
  }

  submitGuess(playerName) {
    const p = this.currentPlayer;
    const isCorrect = fuzzyMatch(playerName, p.name);
    let points = 0;

    if (isCorrect) {
      points = this.maxPossibleScore;
      this._score += points;
    }

    this.roundsData.push({
      player: p,
      cluesUsed: this._currentCluesRevealed,
      pointsEarned: points,
      guessedCorrectly: isCorrect
    });

    return {
      correct: isCorrect,
      pointsEarned: points,
      correctAnswer: p.name
    };
  }

  skipRound() {
    const p = this.currentPlayer;
    this.roundsData.push({
      player: p,
      cluesUsed: this._currentCluesRevealed,
      pointsEarned: 0,
      guessedCorrectly: false
    });
    return { correctAnswer: p.name };
  }

  getMCQOptions() {
    if (this._currentMCQOptions) return this._currentMCQOptions;

    const current = this.currentPlayer;
    if (!current) return [];

    const candidates = this.playerPool.filter(p => p.id !== current.id);
    const targetTeams = (current.teams || []).map(t => t.team);
    const targetLeagues = (current.teams || []).map(t => t.league);

    // Score candidates by similarity to create ultra-smart distractors
    const scoredCandidates = candidates.map(c => {
      let similarityScore = 0;
      const cTeams = (c.teams || []).map(t => t.team);
      const cLeagues = (c.teams || []).map(t => t.league);

      if (c.position === current.position) similarityScore += 3;
      if (c.nationality === current.nationality) similarityScore += 3;
      if (cTeams.some(t => targetTeams.includes(t))) similarityScore += 4; // Shared former club
      if (cLeagues.some(l => targetLeagues.includes(l))) similarityScore += 2; // Shared league

      return { player: c, score: similarityScore };
    });

    let distractors = [];
    if (this.difficulty === 'hard') {
      // Sort descending by similarity score
      scoredCandidates.sort((a, b) => b.score - a.score);
      distractors = scoredCandidates.slice(0, 3).map(item => item.player);
    } else if (this.difficulty === 'medium') {
      // Sort by score but pick randomly from the top 15 to make it slightly less confusing
      scoredCandidates.sort((a, b) => b.score - a.score);
      const top15 = scoredCandidates.slice(0, 15);
      distractors = shuffleArray(top15).slice(0, 3).map(item => item.player);
    } else {
      // Easy: completely random distractors
      const easyPool = shuffleArray(scoredCandidates);
      distractors = easyPool.slice(0, 3).map(item => item.player);
    }

    // Fill remaining if needed (fallback)
    if (distractors.length < 3) {
      const remaining = shuffleArray(candidates.filter(c => !distractors.some(d => d.id === c.id)));
      for (const p of remaining) {
        if (distractors.length < 3) distractors.push(p);
      }
    }

    const options = [current, ...distractors];
    this._currentMCQOptions = shuffleArray(options);
    return this._currentMCQOptions;
  }

  nextRound() {
    if (this.isGameOver) return false;
    this._currentRound++;
    this._currentCluesRevealed = 0;
    this._currentMCQOptions = null;
    this._roundClues = null;
    this._revealedIndices = null;
    this._initRoundClues();
    return !this.isGameOver;
  }

  getResults() {
    const maxScore = 60;
    return {
      totalScore: this._score,
      maxScore,
      rounds: this.roundsData
    };
  }
}
