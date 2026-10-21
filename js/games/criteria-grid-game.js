import { BaseGame } from './base-game.js';
import { Player } from '../models/player.js';

export class CriteriaGridGame extends BaseGame {
    constructor(playerPool, options = {}) {
        // Convert pool to Player instances
        const players = playerPool.map(p => new Player(p));
        super(players, options);

        this.timerEnabled = options.timerEnabled || false;
        this.timerDuration = options.timerDuration || 300;
        this._timeRemaining = this.timerEnabled ? this.timerDuration : null;
        this._timer = null;
        this._isComplete = false;

        this.cells = Array.from({ length: 3 }, () =>
            Array.from({ length: 3 }, () => ({
                filled: false,
                correct: false,
                playerName: null,
                rarity: 0,
                validCount: 0
            }))
        );

        // Generate grid using improved logic
        const gridData = CriteriaGridGame.generateGrid(this.playerPool, this.difficulty);
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

    get isComplete() {
        return this._isComplete || this.score === 9;
    }

    get timeRemaining() {
        return this._timeRemaining;
    }

    getValidPlayers(row, col) {
        const rowVal = this.gridData.rowValues[row];
        const colVal = this.gridData.colValues[col];
        const rowCat = this.gridData.rowCategory;
        const colCat = this.gridData.colCategory;

        return this.playerPool.filter(player => {
            return this._matchesCriterion(player, rowCat, rowVal) &&
                   this._matchesCriterion(player, colCat, colVal);
        });
    }

    getCellRarity(row, col) {
        return this.getValidPlayers(row, col).length;
    }

    _matchesCriterion(player, category, value) {
        return player.matches(category, value);
    }

    submitCell(row, col, playerName) {
        const normalizedInput = playerName.trim().toLowerCase();

        // Check if this player is already used in the grid
        const alreadyUsed = this.cells.flat().some(cell =>
            cell.playerName && cell.playerName.toLowerCase() === normalizedInput
        );

        if (alreadyUsed) {
            return { correct: false, rarity: 0, alreadyUsed: true };
        }

        const validPlayers = this.getValidPlayers(row, col);
        const match = validPlayers.find(p => p.name.toLowerCase() === normalizedInput);

        if (match) {
            this.cells[row][col].filled = true;
            this.cells[row][col].correct = true;
            this.cells[row][col].playerName = match.name;
            this.cells[row][col].rarity = this.cells[row][col].validCount;

            this.trackUsedPlayer(match);
            this.score++;

            if (this.score === 9) {
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
            // Note: usedPlayers set in BaseGame is for pool management,
            // here we just clear the cell state.
            cell.filled = false;
            cell.correct = false;
            cell.playerName = null;
            cell.rarity = 0;
            this.score--;
        }
    }

    startTimer(onTick, onExpire) {
        if (!this.timerEnabled) return;
        this.stopTimer();
        if (onTick) onTick(this._timeRemaining);
        this._timer = setInterval(() => {
            this._timeRemaining--;
            if (this._timeRemaining <= 0) {
                this.stopTimer();
                this._isComplete = true;
                if (onTick) onTick(0);
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

    // Generate candidates for MCQ in UI
    getMCQOptions(row, col) {
        const correctPlayer = this.getValidPlayers(row, col)[0];
        if (!correctPlayer) return [];

        const rowVal = this.gridData.rowValues[row];
        const colVal = this.gridData.colValues[col];
        const rowCat = this.gridData.rowCategory;
        const colCat = this.gridData.colCategory;

        // Smart Distractors: Players who match ONE of the criteria but not both
        const distractors = this.getAvailablePlayers()
            .filter(p => {
                if (p.id === correctPlayer.id) return false;
                const matchRow = this._matchesCriterion(p, rowCat, rowVal);
                const matchCol = this._matchesCriterion(p, colCat, colVal);
                // a a "smart" distractor matches exactly one of the two criteria
                return (matchRow && !matchCol) || (!matchRow && matchCol);
            })
            .sort(() => Math.random() - 0.5)
            .slice(0, 3);

        // Fill remaining slots if not enough smart distractors
        if (distractors.length < 3) {
            const fill = this.getAvailablePlayers()
                .filter(p => p.id !== correctPlayer.id && !distractors.includes(p))
                .sort(() => Math.random() - 0.5)
                .slice(0, 3 - distractors.length);
            distractors.push(...fill);
        }

        return [correctPlayer, ...distractors].sort(() => Math.random() - 0.5);
    }

    static generateGrid(playerPool, difficulty = 'medium') {
        const countOccurrences = (arr) => {
            const counts = {};
            for (const item of arr) {
                counts[item] = (counts[item] || 0) + 1;
            }
            return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
        };

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
            { name: 'Team', values: topTeams },
            { name: 'Trait', values: ['Journeyman (2+ Leagues)', 'Veteran (Age 28+)', 'Young Prospect (Age < 24)', 'Multi-Club Veteran'] }
        ].filter(c => c.values.length >= 3);

        if (categories.length < 2) return null;

        const checkMatch = (p, cat, val) => {
            if (cat === 'Nationality') return p.nationality === val;
            if (cat === 'Position') return p.position === val;
            if (cat === 'League') return p.teams && p.teams.some(t => t.league === val);
            if (cat === 'Team') return p.teams && p.teams.some(t => t.team === val);
            if (cat === 'Trait') {
                if (val === 'Journeyman (2+ Leagues)') return p.isJourneyman();
                if (val === 'Veteran (Age 28+)') return p.age >= 28;
                if (val === 'Young Prospect (Age < 24)') return p.age < 24;
                if (val === 'Multi-Club Veteran') {
                    const teams = new Set((p.teams || []).map(t => t.team));
                    return teams.size >= 2;
                }
                return false;
            }
            return false;
        };

        for (let attempts = 0; attempts < 200; attempts++) {
            let rowCat, colCat;

            if (difficulty === 'easy') {
                rowCat = categories.find(c => c.name === 'Position') || categories[0];
                colCat = categories.find(c => c.name === 'Nationality') || categories[1];
            } else if (difficulty === 'hard') {
                const shuffledCats = [...categories].sort(() => Math.random() - 0.5);
                rowCat = shuffledCats[0];
                colCat = shuffledCats[1];
            } else {
                if (attempts < 150) {
                    rowCat = categories.find(c => c.name === 'Position') || categories[0];
                    const otherCats = categories.filter(c => c.name !== 'Position');
                    colCat = otherCats.length > 0 ? otherCats[Math.floor(Math.random() * otherCats.length)] : rowCat;
                    if (Math.random() > 0.5) [rowCat, colCat] = [colCat, rowCat];
                } else {
                    const shuffledCats = [...categories].sort(() => Math.random() - 0.5);
                    rowCat = shuffledCats[0];
                    colCat = shuffledCats[1];
                }
            }

            if (!rowCat || !colCat) continue;

            const getTopValues = (cat) => {
                const values = cat.values;
                if (difficulty === 'easy') return values.slice(0, 3);
                if (difficulty === 'hard') return [...values.slice(0, 10)].sort(() => Math.random() - 0.5).slice(0, 3);
                return [...values.slice(0, 6)].sort(() => Math.random() - 0.5).slice(0, 3);
            };

            const rowValues = getTopValues(rowCat);
            const colValues = getTopValues(colCat);

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
