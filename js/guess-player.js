import { shuffleArray, getAge, getAgeRange, getFlag, randomFromArray } from './utils.js';

export class GuessPlayerGame {
  constructor(playerPool) {
    if (!playerPool || playerPool.length < 10) {
      throw new Error("Player pool must contain at least 10 players");
    }
    this.playerPool = [...playerPool];
    this.playerPool = shuffleArray(this.playerPool);
    this.targetPlayers = this.playerPool.slice(0, 10);
    this._currentRound = 1;
    this._score = 0;
    this.roundsData = [];
    this._currentCluesRevealed = 0;
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

  get cluesRemaining() {
    return 6 - this._currentCluesRevealed;
  }

  get maxPossibleScore() {
    return 6 - this._currentCluesRevealed; // 6 if 0 clues seen (guessed blind), decreases as clues revealed
  }

  _generateClues(player) {
    const ageRange = getAgeRange ? getAgeRange(player.dateOfBirth) : "Unknown age";
    const teams = player.teams || [];
    const randomTeam = teams.length > 0 ? randomFromArray(teams) : { team: 'Unknown', league: 'Unknown' };
    
    const lastName = player.name.split(' ').pop();
    const initial = lastName.charAt(0);
    const flag = getFlag ? getFlag(player.nationality) : '🏳️';

    return [
      { label: "Nationality", value: `${flag} ${player.nationality}`, icon: "🌍" },
      { label: "Position", value: player.position, icon: "👟" },
      { label: "Age", value: ageRange, icon: "🎂" },
      { label: "League", value: `Played in ${randomTeam.league}`, icon: "🏆" },
      { label: "Team", value: `Played for ${randomTeam.team}`, icon: "👕" },
      { label: "Name", value: `Surname starts with '${initial}'`, icon: "🔤" }
    ];
  }

  revealNextClue() {
    if (this._currentCluesRevealed >= 6) return null;
    const allClues = this._generateClues(this.currentPlayer);
    this._currentCluesRevealed++;
    return allClues[this._currentCluesRevealed - 1];
  }

  submitGuess(playerName) {
    const p = this.currentPlayer;
    const isCorrect = playerName.toLowerCase() === p.name.toLowerCase();
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

    const pool = this.playerPool.filter(p => p.id !== current.id);
    
    // Pick distractors that share position or nationality if available
    const smartDistractors = pool.filter(p => p.position === current.position || p.nationality === current.nationality);
    const shuffledSmart = shuffleArray(smartDistractors);
    
    const distractors = [];
    for (const p of shuffledSmart) {
      if (distractors.length < 3 && !distractors.some(d => d.id === p.id)) {
        distractors.push(p);
      }
    }
    
    // Fill remaining distractors from general pool if needed
    if (distractors.length < 3) {
      const remainingPool = shuffleArray(pool.filter(p => !distractors.some(d => d.id === p.id)));
      for (const p of remainingPool) {
        if (distractors.length < 3) {
          distractors.push(p);
        }
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
    return !this.isGameOver;
  }

  getResults() {
    return {
      totalScore: this._score,
      maxScore: 60,
      rounds: this.roundsData
    };
  }
}
