import { shuffleArray } from './utils.js';

export class CriteriaGridGame {
  constructor(playerPool, options = {}) {
    this.playerPool = playerPool;
    this.timerEnabled = options.timerEnabled || false;
    this.timerDuration = options.timerDuration || 300;
    this._timeRemaining = this.timerEnabled ? this.timerDuration : null;
    this._timer = null;
    this._score = 0;
    this._usedPlayers = new Set();
    this.cells = Array.from({ length: 3 }, () => 
      Array.from({ length: 3 }, () => ({ filled: false, correct: false, playerName: null, rarity: 0, validCount: 0 }))
    );
    this._isComplete = false;
    
    // Generate grid
    const gridData = CriteriaGridGame.generateGrid(playerPool);
    if (!gridData) throw new Error("Could not generate a valid grid from the player pool.");
    
    this.gridData = gridData;
    
    // Pre-calculate valid counts for each cell
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        this.cells[r][c].validCount = this.getCellRarity(r, c);
      }
    }
  }

  get grid() {
    return {
      rowCategory: this.gridData.rowCategory,
      colCategory: this.gridData.colCategory,
      rowValues: this.gridData.rowValues,
      colValues: this.gridData.colValues,
      cells: this.cells
    };
  }

  get score() { return this._score; }
  get maxScore() { return 9; }
  get isComplete() { return this._isComplete || this._score === 9; }
  get timeRemaining() { return this._timeRemaining; }
  get usedPlayers() { return this._usedPlayers; }

  getValidPlayers(row, col) {
    const rowVal = this.gridData.rowValues[row];
    const colVal = this.gridData.colValues[col];
    const rowCat = this.gridData.rowCategory;
    const colCat = this.gridData.colCategory;

    return this.playerPool.filter(player => {
      return this._matchesCriterion(player, rowCat, rowVal) && 
             this._matchesCriterion(player, colCat, colVal);
    }).map(p => p.name);
  }

  getCellRarity(row, col) {
    return this.getValidPlayers(row, col).length;
  }

  _matchesCriterion(player, category, value) {
    if (category === 'Nationality') return player.nationality === value;
    if (category === 'Position') return player.position === value;
    if (category === 'League') {
      return player.teams && player.teams.some(t => t.league === value);
    }
    if (category === 'Team') {
      return player.teams && player.teams.some(t => t.team === value);
    }
    return false;
  }

  submitCell(row, col, playerName) {
    if (this._usedPlayers.has(playerName)) {
      return { correct: false, rarity: 0, alreadyUsed: true };
    }

    const validNames = this.getValidPlayers(row, col).map(n => n.toLowerCase());
    const isCorrect = validNames.includes(playerName.toLowerCase());

    if (isCorrect) {
      this.cells[row][col].filled = true;
      this.cells[row][col].correct = true;
      this.cells[row][col].playerName = playerName;
      this.cells[row][col].rarity = this.cells[row][col].validCount;
      this._usedPlayers.add(playerName);
      this._score++;
      
      if (this._score === 9) {
        this._isComplete = true;
        this.stopTimer();
      }
      
      return { correct: true, rarity: this.cells[row][col].rarity, alreadyUsed: false };
    }
    
    return { correct: false, rarity: 0, alreadyUsed: false };
  }

  clearCell(row, col) {
    const cell = this.cells[row][col];
    if (cell.filled && cell.playerName) {
      this._usedPlayers.delete(cell.playerName);
      cell.filled = false;
      cell.correct = false;
      cell.playerName = null;
      cell.rarity = 0;
      this._score--;
    }
  }

  startTimer(onTick, onExpire) {
    if (!this.timerEnabled) return;
    this.stopTimer();
    this._timer = setInterval(() => {
      this._timeRemaining--;
      if (this._timeRemaining <= 0) {
        this.stopTimer();
        this._isComplete = true;
        if (onExpire) onExpire();
      } else {
        if (onTick) onTick(this._timeRemaining);
      }
    }, 1000);
  }

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  getResults() {
    return {
      score: this._score,
      maxScore: 9,
      cells: this.cells
    };
  }

  static generateGrid(playerPool) {
    const countOccurrences = (arr) => {
      const counts = {};
      for (const item of arr) {
        counts[item] = (counts[item] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    };

    // 1. Extract possible criteria
    const topNationalities = countOccurrences(playerPool.map(p => p.nationality).filter(Boolean));
    const topPositions = countOccurrences(playerPool.map(p => p.position).filter(Boolean));
    
    const allLeagues = [];
    const allTeams = [];
    playerPool.forEach(p => {
      if (p.teams) {
        p.teams.forEach(t => {
          if (t.league) allLeagues.push(t.league);
          if (t.team) allTeams.push(t.team);
        });
      }
    });
    const topLeagues = countOccurrences(allLeagues);
    const topTeams = countOccurrences(allTeams);

    const categories = [
      { name: 'Nationality', values: topNationalities },
      { name: 'Position', values: topPositions },
      { name: 'League', values: topLeagues },
      { name: 'Team', values: topTeams }
    ].filter(c => c.values.length >= 3);

    if (categories.length < 2) return null;

    const checkMatch = (p, cat, val) => {
      if (cat === 'Nationality') return p.nationality === val;
      if (cat === 'Position') return p.position === val;
      if (cat === 'League') return p.teams && p.teams.some(t => t.league === val);
      if (cat === 'Team') return p.teams && p.teams.some(t => t.team === val);
      return false;
    };

    for (let attempts = 0; attempts < 200; attempts++) {
      let rowCat, colCat;
      
      // Try Position as one axis for most attempts
      if (attempts < 150) {
        rowCat = categories.find(c => c.name === 'Position');
        const otherCats = categories.filter(c => c.name !== 'Position');
        if (otherCats.length > 0) {
          colCat = otherCats[Math.floor(Math.random() * otherCats.length)];
        } else {
          colCat = rowCat;
        }
        if (Math.random() > 0.5) [rowCat, colCat] = [colCat, rowCat];
      } else {
        const cats = [...categories];
        shuffleArray(cats);
        rowCat = cats[0];
        colCat = cats[1];
      }

      if (!rowCat || !colCat) continue;
      
      const getTopValues = (cat) => {
        const topPool = cat.values.slice(0, 6);
        shuffleArray(topPool);
        return topPool.slice(0, 3);
      };

      const rowValues = getTopValues(rowCat);
      const colValues = getTopValues(colCat);

      // Validate intersection
      let isValid = true;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const matchingPlayers = playerPool.filter(p => 
            checkMatch(p, rowCat.name, rowValues[r]) && 
            checkMatch(p, colCat.name, colValues[c])
          );
          if (matchingPlayers.length === 0) {
            isValid = false;
            break;
          }
        }
        if (!isValid) break;
      }

      if (isValid) {
        return {
          rowCategory: rowCat.name,
          colCategory: colCat.name,
          rowValues,
          colValues
        };
      }
    }
    
    // Fallback: Position x League (most likely to work since every player has both)
    const posCat = categories.find(c => c.name === 'Position');
    const leaCat = categories.find(c => c.name === 'League');
    if (posCat && leaCat) {
       return {
         rowCategory: 'Position',
         colCategory: 'League',
         rowValues: posCat.values.slice(0, 3),
         colValues: leaCat.values.slice(0, 3)
       };
    }

    return null;
  }
}
