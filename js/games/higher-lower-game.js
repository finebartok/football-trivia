import { shuffleArray, getAge } from '../utils.js';

export class HigherLowerGame {
  constructor(playerPool, options = {}) {
    if (!playerPool || playerPool.length < 5) {
      throw new Error("Player pool must contain at least 5 players");
    }
    this.difficulty = options.difficulty || 'medium';
    this.playerPool = shuffleArray([...playerPool]);
    this._streak = 0;
    this._isGameOver = false;
    this.usedIndices = new Set();
    
    // Choose game metric
    const metrics = [
      { id: 'marketValue', label: 'Peak Market Value', unit: '€M' },
      { id: 'caps', label: 'International Caps', unit: 'caps' },
      { id: 'careerGoals', label: 'Senior Career Goals', unit: 'goals' },
      { id: 'trophies', label: 'Major Trophies Won', unit: 'trophies' },
      { id: 'shirtNumber', label: 'Shirt / Jersey Number', unit: '#' },
      { id: 'age', label: 'Age', unit: 'years old' }
    ];
    this.metric = metrics[Math.floor(Math.random() * metrics.length)];

    this.leftPlayer = this.playerPool[0];
    this.usedIndices.add(0);
    this.rightPlayer = this._getNextPlayer();
  }

  get streak() { return this._streak; }
  get isGameOver() { return this._isGameOver; }

  getStatValue(player) {
    if (!player) return 0;
    if (this.metric.id === 'marketValue') return player.marketValue || 0;
    if (this.metric.id === 'caps') return player.caps || 0;
    if (this.metric.id === 'careerGoals') return player.careerGoals || 0;
    if (this.metric.id === 'trophies') return player.trophies ? player.trophies.length : 0;
    if (this.metric.id === 'shirtNumber') return player.shirtNumber || 0;
    if (this.metric.id === 'age') return getAge(player.dateOfBirth);
    return 0;
  }

  _getNextPlayer(depth = 0) {
    if (depth >= 3) {
      this._isGameOver = true;
      return this.playerPool[0];
    }
    const leftVal = this.leftPlayer ? this.getStatValue(this.leftPlayer) : null;

    // 1. Try to find a candidate based on difficulty
    if (this.difficulty === 'hard') {
      // Hard: Find a player with a stat value VERY close to the current one (minimal difference)
      let bestCandidateIdx = -1;
      let minDiff = Infinity;

      for (let i = 0; i < this.playerPool.length; i++) {
        if (this.usedIndices.has(i)) continue;
        const diff = Math.abs(this.getStatValue(this.playerPool[i]) - leftVal);
        if (diff > 0 && diff < minDiff) {
          minDiff = diff;
          bestCandidateIdx = i;
        }
      }
      if (bestCandidateIdx !== -1) {
        this.usedIndices.add(bestCandidateIdx);
        return this.playerPool[bestCandidateIdx];
      }
    } else if (this.difficulty === 'easy') {
      // Easy: Find a player with a significant difference
      for (let i = 0; i < this.playerPool.length; i++) {
        if (this.usedIndices.has(i)) continue;
        const diff = Math.abs(this.getStatValue(this.playerPool[i]) - leftVal);
        if (diff > 20) { // Arbitrary threshold for 'easy' variance
          this.usedIndices.add(i);
          return this.playerPool[i];
        }
      }
    }

    // Fallback: standard distinct value search (Medium/Fallback)
    for (let i = 0; i < this.playerPool.length; i++) {
      if (!this.usedIndices.has(i)) {
        const candidate = this.playerPool[i];
        if (leftVal === null || this.getStatValue(candidate) !== leftVal) {
          this.usedIndices.add(i);
          return candidate;
        }
      }
    }

    // 2. Try any candidate in pool with a different stat value (even if visited)
    for (let i = 0; i < this.playerPool.length; i++) {
      const candidate = this.playerPool[i];
      if (leftVal === null || this.getStatValue(candidate) !== leftVal) {
        return candidate;
      }
    }

    // 3. Fallback: switch metric if current metric has no distinct candidates left
    const metrics = [
      { id: 'marketValue', label: 'Peak Market Value', unit: '€M' },
      { id: 'caps', label: 'International Caps', unit: 'caps' },
      { id: 'careerGoals', label: 'Senior Career Goals', unit: 'goals' },
      { id: 'trophies', label: 'Major Trophies Won', unit: 'trophies' },
      { id: 'shirtNumber', label: 'Shirt / Jersey Number', unit: '#' },
      { id: 'age', label: 'Age', unit: 'years old' }
    ].filter(m => m.id !== this.metric.id);

    if (metrics.length > 0) {
      this.metric = metrics[Math.floor(Math.random() * metrics.length)];
      return this._getNextPlayer(depth + 1);
    }

    return this.playerPool[0];
  }

  makeGuess(choice) { // 'higher' or 'lower'
    if (this._isGameOver) return null;

    const leftVal = this.getStatValue(this.leftPlayer);
    const rightVal = this.getStatValue(this.rightPlayer);

    let isCorrect = false;
    if (rightVal === leftVal) {
      isCorrect = true;
    } else if (choice === 'higher') {
      isCorrect = rightVal > leftVal;
    } else if (choice === 'lower') {
      isCorrect = rightVal < leftVal;
    }

    if (isCorrect) {
      this._streak++;
      const prevRight = this.rightPlayer;
      const nextRight = this._getNextPlayer();
      this.leftPlayer = prevRight;
      this.rightPlayer = nextRight;
    } else {
      this._isGameOver = true;
    }

    return {
      correct: isCorrect,
      streak: this._streak,
      leftValue: leftVal,
      rightValue: rightVal,
      leftPlayer: this.leftPlayer,
      rightPlayer: this.rightPlayer,
      metric: this.metric
    };
  }

  getResults() {
    return {
      totalScore: this._streak,
      metricLabel: this.metric.label
    };
  }
}
