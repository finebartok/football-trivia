export class BaseGame {
    constructor(playerPool, options = {}) {
        this.playerPool = this._shuffle([...playerPool]);
        this.difficulty = options.difficulty || 'medium';
        this.score = 0;
        this.streak = 0;
        this.usedPlayers = new Set();
        this.gameState = 'initializing';
    }

    _shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    trackUsedPlayer(player) {
        this.usedPlayers.add(player.id);
    }

    isPlayerUsed(playerId) {
        return this.usedPlayers.has(playerId);
    }

    getAvailablePlayers() {
        return this.playerPool.filter(p => !this.isPlayerUsed(p.id));
    }

    getResults() {
        return {
            score: this.score,
            streak: this.streak,
            difficulty: this.difficulty,
            playersUsed: this.usedPlayers.size
        };
    }

    // To be implemented by subclasses
    start() {
        throw new Error('Method start() must be implemented');
    }

    render() {
        throw new Error('Method render() must be implemented');
    }
}
