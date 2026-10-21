import { loadData, getAllPlayers, getPlayersByScope, searchPlayers, getTeams, getNationalities, getSeasonRange } from './data.js';
import { createScope, saveScope, loadScopes, deleteScope, getScopeSummary, validateScope, createQuickPlayScope, PRESET_SCOPES, encodeScopeToHash, decodeScopeFromHash } from './scope.js';
import { GuessPlayerGame } from './games/guess-player-game.js';
import { CriteriaGridGame } from './games/criteria-grid-game.js';
import { HigherLowerGame } from './games/higher-lower-game.js';
import { createConfetti, debounce, GameEffects } from './utils.js';
import { Player } from './models/player.js';
import { ICON_MAP, getIcon } from './assets.js';

class App {
    constructor() {
        this.activeScope = null;
        this.currentGame = null;
        this.currentGameType = null;
        this.currentView = 'home';
        this.selectedDifficulty = 'medium';
        this.scopeBuilderState = { leagues: new Set(), start: 2020, end: 2025, teams: [], nationalities: [] };
        this.activeGridCell = null;
        this.playerPool = [];
        this.currentPool = [];

        this.views = {
            home: document.getElementById('home-view'),
            'format-picker': document.getElementById('format-picker-view'),
            'guess-player': document.getElementById('guess-player-view'),
            'higher-lower': document.getElementById('higher-lower-view'),
            'criteria-grid': document.getElementById('criteria-grid-view'),
            results: document.getElementById('results-view')
        };

        this.UI = {
            scopeBuilder: document.getElementById('scope-builder'),
            formatGuessPlayer: document.getElementById('format-guess-player'),
            formatHigherLower: document.getElementById('format-higher-lower'),
            formatCriteriaGrid: document.getElementById('format-criteria-grid'),
            btnBackFormats: document.getElementById('btn-back-formats'),

            gameOverlay: document.getElementById('game-overlay'),
            overlayTitle: document.getElementById('overlay-title'),
            overlaySubtitle: document.getElementById('overlay-subtitle'),
            btnOverlayClose: document.getElementById('btn-overlay-close'),

            guessRoundCounter: document.getElementById('guess-round-counter'),
            guessScoreDisplay: document.getElementById('guess-score-display'),
            guessClueCards: document.getElementById('guess-clue-cards'),
            guessMcqOptions: document.getElementById('guess-mcq-options'),
            btnSkipGuess: document.getElementById('btn-skip-guess'),
            btnNextGuess: document.getElementById('btn-next-guess'),

            hlMetricLabel: document.getElementById('hl-metric-label'),
            hlStreakDisplay: document.getElementById('hl-streak-display'),
            hlLeftName: document.getElementById('hl-left-name'),
            hlLeftMeta: document.getElementById('hl-left-meta'),
            hlLeftVal: document.getElementById('hl-left-val'),
            hlLeftUnit: document.getElementById('hl-left-unit'),
            hlRightName: document.getElementById('hl-right-name'),
            hlRightMeta: document.getElementById('hl-right-meta'),
            hlRightVal: document.getElementById('hl-right-val'),
            hlRightUnit: document.getElementById('hl-right-unit'),
            hlGuessBox: document.getElementById('hl-guess-box'),
            hlRightStatBox: document.getElementById('hl-right-stat-box'),
            btnHlHigher: document.getElementById('btn-hl-higher'),
            btnHlLower: document.getElementById('btn-hl-lower'),
            btnHlNext: document.getElementById('btn-hl-next'),

            gridTimer: document.getElementById('grid-timer'),
            gridScoreDisplay: document.getElementById('grid-score-display'),
            criteriaGridBoard: document.getElementById('criteria-grid-board'),
            gridInputArea: document.getElementById('grid-input-area'),
            gridMcqOptions: document.getElementById('grid-mcq-options'),
            gridPlayerInput: document.getElementById('grid-player-input'),
            gridAutocompleteList: document.getElementById('grid-autocomplete-list'),
            btnNewGrid: document.getElementById('btn-new-grid'),
            btnBackGrid: document.getElementById('btn-back-grid'),

            finalScore: document.getElementById('final-score'),
            resultsProgress: document.getElementById('results-progress'),
            resultsSummary: document.getElementById('results-summary'),
            identitySummary: document.getElementById('identity-summary'),
            btnShareScope: document.getElementById('btn-share-scope'),
            btnPlayAgain: document.getElementById('btn-play-again'),
            btnResultsHome: document.getElementById('btn-results-home'),

            featuredScopesList: document.getElementById('featured-scopes-list'),
            savedScopesList: document.getElementById('saved-scopes-list'),
            btnQuickPlay: document.getElementById('btn-quick-play'),
            btnCreateScope: document.getElementById('btn-create-scope'),
            toastContainer: document.getElementById('toast-container'),

            scopeName: document.getElementById('scope-name'),
            btnSaveScope: document.getElementById('btn-save-scope'),
            btnCancelScope: document.getElementById('btn-cancel-scope'),
            scopePoolPreview: document.getElementById('pool-sample') || document.getElementById('scope-pool-preview'),
            scopePoolCount: document.getElementById('pool-count') || document.getElementById('scope-pool-count'),
            leagueBadges: document.querySelectorAll('.league-badge'),
            eraStart: document.getElementById('era-start'),
            eraEnd: document.getElementById('era-end'),
            eraStartLabel: document.getElementById('era-start-label'),
            eraEndLabel: document.getElementById('era-end-label'),
            teamSearch: document.getElementById('team-search'),
            teamDropdown: document.getElementById('team-dropdown'),
            nationalitySearch: document.getElementById('nationality-search'),
            nationalityDropdown: document.getElementById('nationality-dropdown')
        };

        this.LEAGUE_MAP = {
            'premier-league': 'Premier League',
            'la-liga': 'La Liga',
            'bundesliga': 'Bundesliga',
            'serie-a': 'Serie A',
            'ligue-1': 'Ligue 1'
        };
    }

    async init() {
        this.playerPool = await loadData();
        this.currentPool = this.playerPool;

        await this.initEraSliders();
        this.setupEventListeners();
        this.renderHome();

        if (window.location.hash.includes('scope=')) {
            const sharedScope = decodeScopeFromHash(window.location.hash);
            if (sharedScope) {
                this.activeScope = sharedScope;
                this.currentPool = getPlayersByScope(this.activeScope);
                this.showToast(`Loaded shared scope: "${sharedScope.name}"`, 'success');
                window.location.hash = '#format-picker';
                return;
            }
        }

        this.navigate(window.location.hash || '#home');
    }

    async initEraSliders() {
        const range = getSeasonRange();
        this.scopeBuilderState.start = range.start;
        this.scopeBuilderState.end = range.end;

        if (this.UI.eraStart && this.UI.eraEnd) {
            this.UI.eraStart.min = range.start;
            this.UI.eraStart.max = range.end;
            this.UI.eraStart.value = range.start;
            this.UI.eraEnd.min = range.start;
            this.UI.eraEnd.max = range.end;
            this.UI.eraEnd.value = range.end;
            this.UI.eraStartLabel.textContent = range.start;
            this.UI.eraEndLabel.textContent = range.end;
        }
    }

    navigate(hash) {
        const viewName = hash.replace('#', '');
        if (!this.views[viewName]) return;

        // Stop any active game timers when navigating away
        if (this.currentGame && this.currentGame.stopTimer) {
            this.currentGame.stopTimer();
        }

        Object.values(this.views).forEach(v => {
            if (v) v.classList.remove('active');
        });

        this.views[viewName].classList.add('active');
        this.currentView = viewName;

        if (viewName === 'home') this.renderHome();
    }

    setupEventListeners() {
        // Navigation
        this.UI.btnQuickPlay.addEventListener('click', () => {
            this.activeScope = createQuickPlayScope();
            this.currentPool = this.playerPool;
            window.location.hash = '#format-picker';
        });

        this.UI.btnBackFormats.addEventListener('click', () => {
            window.location.hash = '#home';
        });

        this.UI.btnPlayAgain.addEventListener('click', () => {
            this.startFormat(this.currentGameType);
        });

        this.UI.btnResultsHome.addEventListener('click', () => {
            window.location.hash = '#home';
        });

        // Scope Builder
        this.UI.btnCreateScope.addEventListener('click', () => {
            const range = getSeasonRange();
            this.scopeBuilderState = {
                leagues: new Set(),
                start: range.start,
                end: range.end,
                teams: [],
                nationalities: []
            };
            this.UI.leagueBadges.forEach(b => b.classList.remove('selected'));
            this.UI.eraStart.value = range.start;
            this.UI.eraEnd.value = range.end;
            this.UI.eraStartLabel.textContent = range.start;
            this.UI.eraEndLabel.textContent = range.end;
            this.UI.scopeName.value = '';
            this.UI.teamSearch.value = '';
            this.UI.nationalitySearch.value = '';
            this.updateScopePreview();
            this.UI.scopeBuilder.classList.add('active');
        });

        this.UI.btnCancelScope.addEventListener('click', () => {
            this.UI.scopeBuilder.classList.remove('active');
        });

        this.UI.leagueBadges.forEach(badge => {
            badge.addEventListener('click', () => {
                const league = badge.dataset.league;
                if (this.scopeBuilderState.leagues.has(league)) {
                    this.scopeBuilderState.leagues.delete(league);
                    badge.classList.remove('selected');
                } else {
                    this.scopeBuilderState.leagues.add(league);
                    badge.classList.add('selected');
                }
                this.updateScopePreview();
            });
        });

        const syncEras = () => {
            const s = parseInt(this.UI.eraStart.value);
            const e = parseInt(this.UI.eraEnd.value);
            if (s > e) {
                this.UI.eraStart.value = e;
                this.UI.eraEnd.value = s;
            }
            this.scopeBuilderState.start = parseInt(this.UI.eraStart.value);
            this.scopeBuilderState.end = parseInt(this.UI.eraEnd.value);
            this.UI.eraStartLabel.textContent = this.UI.eraStart.value;
            this.UI.eraEndLabel.textContent = this.UI.eraEnd.value;
            this.updateScopePreview();
        };

        this.UI.eraStart.addEventListener('input', syncEras);
        this.UI.eraEnd.addEventListener('input', syncEras);

        this.UI.btnSaveScope.addEventListener('click', () => {
            const name = this.UI.scopeName.value.trim() || 'Custom Scope';
            const filters = [];

            if (this.scopeBuilderState.leagues.size > 0) {
                this.scopeBuilderState.leagues.forEach(l => {
                    filters.push({ league: this.LEAGUE_MAP[l], seasonStart: this.scopeBuilderState.start, seasonEnd: this.scopeBuilderState.end });
                });
            } else {
                Object.values(this.LEAGUE_MAP).forEach(l => {
                    filters.push({ league: l, seasonStart: this.scopeBuilderState.start, seasonEnd: this.scopeBuilderState.end });
                });
            }

            const scope = createScope(name, filters, this.scopeBuilderState.teams, this.scopeBuilderState.nationalities);
            const pool = getPlayersByScope(scope);
            const validation = validateScope(scope, pool);

            if (!validation.valid) {
                this.showToast(validation.message, 'error');
                return;
            }

            saveScope(scope);
            this.activeScope = scope;
            this.currentPool = getPlayersByScope(scope);
            this.UI.scopeBuilder.classList.remove('active');
            window.location.hash = '#format-picker';
        });

        this.setupAutocomplete(this.UI.teamSearch, this.UI.teamDropdown, this.playerPool, (teamName) => {
            if (!this.scopeBuilderState.teams.includes(teamName)) {
                this.scopeBuilderState.teams.push(teamName);
                this.updateScopePreview();
                this.showToast(`Added team: ${teamName}`);
            }
            this.UI.teamSearch.value = '';
        }, () => {
            const selectedLeagues = Array.from(this.scopeBuilderState.leagues).map(l => this.LEAGUE_MAP[l]);
            let teams = [];
            if (selectedLeagues.length > 0) {
                selectedLeagues.forEach(l => teams = teams.concat(getTeams(l)));
            } else {
                teams = getTeams();
            }
            return teams.map(t => ({ name: t }));
        });

        this.setupAutocomplete(this.UI.nationalitySearch, this.UI.nationalityDropdown, this.playerPool, (natName) => {
            if (!this.scopeBuilderState.nationalities.includes(natName)) {
                this.scopeBuilderState.nationalities.push(natName);
                this.updateScopePreview();
                this.showToast(`Added nationality: ${natName}`);
            }
            this.UI.nationalitySearch.value = '';
        }, () => getNationalities().map(n => ({ name: n })));

        const diffToggle = document.getElementById('difficulty-toggle');
        if (diffToggle) {
            const btns = diffToggle.querySelectorAll('.difficulty-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', () => {
                    btns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.selectedDifficulty = btn.dataset.difficulty;
                    this.showToast(`Difficulty set to ${this.selectedDifficulty.toUpperCase()} 🎯`, 'info');
                });
            });
        }

        if (this.UI.formatGuessPlayer) this.UI.formatGuessPlayer.addEventListener('click', () => this.startFormat('guess-player'));
        if (this.UI.formatHigherLower) this.UI.formatHigherLower.addEventListener('click', () => this.startFormat('higher-lower'));
        if (this.UI.formatCriteriaGrid) this.UI.formatCriteriaGrid.addEventListener('click', () => this.startFormat('criteria-grid'));

        if (this.UI.btnHlHigher) this.UI.btnHlHigher.addEventListener('click', () => this.handleHigherLowerGuess('higher'));
        if (this.UI.btnHlLower) this.UI.btnHlLower.addEventListener('click', () => this.handleHigherLowerGuess('lower'));
        if (this.UI.btnHlNext) this.UI.btnHlNext.addEventListener('click', () => {
            this.UI.btnHlNext.classList.add('hidden');
            this.UI.hlGuessBox.classList.remove('hidden');
            this.UI.hlRightStatBox.classList.add('hidden');
            this.renderHigherLowerRound();
        });

        if (this.UI.btnSkipGuess) {
            this.UI.btnSkipGuess.addEventListener('click', () => {
                if (!this.currentGame || this.currentGameType !== 'guess-player') return;
                this.currentGame.skipRound();
                this.endGuessRound(false);
            });
        }

        if (this.UI.btnNextGuess) {
            this.UI.btnNextGuess.addEventListener('click', () => {
                if (!this.currentGame || this.currentGameType !== 'guess-player') {
                    return;
                }
                if (this.currentGame.nextRound()) {
                    this.renderGuessRound();
                } else {
                    this.showResults();
                }
            });
        }

        const btnRevealClue = document.getElementById('btn-reveal-clue');
        if (btnRevealClue) {
            btnRevealClue.addEventListener('click', async () => {
                if (!this.currentGame || this.currentGameType !== 'guess-player' || this.currentGame.cluesRemaining <= 0) return;
                const res = this.currentGame.revealRandomClue();
                if (res && res.clue) {
                    const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
                    const card = clueCards[res.index];
                    if (card) {
                        await GameEffects.revealSequence(card);
                        const back = card.querySelector('.clue-back');
                        const icon = getIcon(res.clue.iconKey);
                        back.innerHTML = `<div class="clue-icon">${icon}</div><span class="text text-sm" style="text-align: center;">${res.clue.value}</span>`;
                        this.UI.guessScoreDisplay.textContent = `Score: ${this.currentGame.currentScore} (Max: ${this.currentGame.maxPossibleScore})`;
                    }
                }
            });
        }


        const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
        clueCards.forEach((card, index) => {
            card.addEventListener('click', async () => {
                if (!this.currentGame || this.currentGameType !== 'guess-player') return;
                if (card.classList.contains('revealed')) return;

                const res = this.currentGame.revealClueAtIndex(index);
                if (res && res.clue) {
                    await GameEffects.revealSequence(card);
                    const back = card.querySelector('.clue-back');
                    const icon = getIcon(res.clue.iconKey);
                    back.innerHTML = `<div class="clue-icon">${icon}</div><span class="text text-sm" style="text-align: center;">${res.clue.value}</span>`;
                    this.UI.guessScoreDisplay.textContent = `Score: ${this.currentGame.currentScore} (Max: ${this.currentGame.maxPossibleScore})`;
                }
            });
        });


        if (this.UI.btnNewGrid) {
            this.UI.btnNewGrid.addEventListener('click', () => this.startFormat('criteria-grid'));
        }
        if (this.UI.btnBackGrid) {
            this.UI.btnBackGrid.addEventListener('click', () => window.location.hash = '#format-picker');
        }

        this.setupAutocomplete(this.UI.gridPlayerInput, this.UI.gridAutocompleteList, null, (playerName) => {
            if (this.activeGridCell) {
                const { row, col } = this.activeGridCell;
                const result = this.currentGame.submitCell(row, col, playerName);
                if (result.alreadyUsed) {
                    this.showToast('Player already used!', 'warning');
                } else if (result.correct) {
                    const cellEl = this.UI.criteriaGridBoard.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
                    cellEl.classList.add('filled');
                    cellEl.innerHTML = `<span class="player-name">${playerName}</span>`;
                    this.UI.gridScoreDisplay.textContent = `Score: ${this.currentGame.score}/9`;
                    this.UI.gridInputArea.classList.add('hidden');
                    if (this.currentGame.isComplete) this.showResults();
                } else {
                    const cellEl = this.UI.criteriaGridBoard.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
                    cellEl.classList.add('incorrect');
                    setTimeout(() => cellEl.classList.remove('incorrect'), 500);
                    this.showToast('Incorrect player!', 'error');
                }
                this.UI.gridPlayerInput.value = '';
            }
        });
    }

    updateScopePreview() {
        const filters = [];
        if (this.scopeBuilderState.leagues.size > 0) {
            this.scopeBuilderState.leagues.forEach(l => {
                filters.push({ league: this.LEAGUE_MAP[l], seasonStart: this.scopeBuilderState.start, seasonEnd: this.scopeBuilderState.end });
            });
        } else {
            Object.values(this.LEAGUE_MAP).forEach(l => {
                filters.push({ league: l, seasonStart: this.scopeBuilderState.start, seasonEnd: this.scopeBuilderState.end });
            });
        }

        const scope = createScope("Preview", filters, this.scopeBuilderState.teams, this.scopeBuilderState.nationalities);
        const matched = getPlayersByScope(scope);

        if (this.UI.scopePoolCount) this.UI.scopePoolCount.textContent = matched.length;
        if (this.UI.scopePoolPreview) {
            const sample = matched.slice(0, 5).map(p => p.name).join(', ');
            this.UI.scopePoolPreview.textContent = sample || 'No players found.';
        }
    }

    renderHome() {
        if (this.UI.featuredScopesList) {
            this.UI.featuredScopesList.innerHTML = '';
            PRESET_SCOPES.forEach(preset => {
                const card = document.createElement('div');
                card.className = 'featured-scope-card card-broadcast holographic';
                card.innerHTML = `
                    <div class="featured-scope-icon">${preset.icon}</div>
                    <div class="text-left">
                        <h3 class="text-heavy text-primary">${preset.name}</h3>
                        <p class="text-sm text-secondary mt-1">${preset.description}</p>
                    </div>
                `;
                card.addEventListener('click', () => {
                    this.activeScope = preset;
                    this.currentPool = getPlayersByScope(this.activeScope);
                    this.showToast(`Loaded "${preset.name}" scope (${this.currentPool.length} players)`, 'info');
                    window.location.hash = '#format-picker';
                });
            });
        }


        const scopes = loadScopes();
        this.UI.savedScopesList.innerHTML = '';

        scopes.forEach(scope => {
            const card = document.createElement('div');
            card.className = 'card scope-card card-broadcast holographic';
            card.innerHTML = `
                <h3 class="text-heavy text-primary">${scope.name}</h3>
                <p class="text-sm text-secondary mt-1">${getScopeSummary(scope)}</p>
                <div class="flex gap-2 mt-3">
                    <button class="btn btn-primary flex-1 btn-play-scope btn-broadcast">Play</button>
                    <button class="btn btn-secondary btn-delete-scope btn-broadcast">Delete</button>
                </div>
            `;


            card.querySelector('.btn-play-scope').addEventListener('click', () => {
                this.activeScope = scope;
                this.currentPool = getPlayersByScope(this.activeScope);
                window.location.hash = '#format-picker';
            });

            card.querySelector('.btn-delete-scope').addEventListener('click', () => {
                deleteScope(scope.id);
                this.renderHome();
            });
        });
    }

    startFormat(format) {
        this.currentGameType = format;
        this.currentPool = getPlayersByScope(this.activeScope);

        // Sequence: Overlay -> Game
        this.UI.overlayTitle.textContent = format === 'guess-player' ? 'Guess the Star' :
                                           format === 'higher-lower' ? 'Stat Battle' : 'Grid Master';
        this.UI.overlaySubtitle.textContent = `Scope: ${this.activeScope ? this.activeScope.name : 'Quick Play'}`;
        this.UI.gameOverlay.classList.add('active');

        try {
            if (format === 'guess-player') {
                this.currentGame = new GuessPlayerGame(this.currentPool, { difficulty: this.selectedDifficulty });
                this.renderGuessRound();
                window.location.hash = '#guess-player';
            } else if (format === 'higher-lower') {
                this.currentGame = new HigherLowerGame(this.currentPool, { difficulty: this.selectedDifficulty });
                this.renderHigherLowerRound();
                window.location.hash = '#higher-lower';

            } else if (format === 'criteria-grid') {
                this.currentGame = new CriteriaGridGame(this.currentPool, {
                    difficulty: this.selectedDifficulty,
                    timerEnabled: true,
                    timerDuration: 300
                });
                this.renderCriteriaGrid();
                window.location.hash = '#criteria-grid';
            }
        } catch (e) {
            this.showToast(e.message, 'error');
        }
    }

    async renderGuessRound() {
        this.UI.guessRoundCounter.textContent = `Round ${this.currentGame.currentRound}/${this.currentGame.totalRounds}`;
        this.UI.guessScoreDisplay.textContent = `Score: ${this.currentGame.currentScore} (Max: ${this.currentGame.maxPossibleScore})`;

        const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
        clueCards.forEach((card) => {
            card.classList.remove('revealed');
            card.querySelector('.clue-front').innerHTML = `<span>?</span>`;
            card.querySelector('.clue-back').innerHTML = '';
            card.style.cursor = 'pointer';
            card.style.boxShadow = '0 0 12px rgba(0, 230, 118, 0.3)';
        });

        // Assign currentGuessCard to the clue container element itself, not the list
        this.UI.currentGuessCard = this.UI.guessClueCards;

        const options = this.currentGame.getMCQOptions();
        this.UI.guessMcqOptions.innerHTML = '';
        options.forEach((opt, index) => {
            const btn = document.createElement('button');
            btn.className = 'mcq-option-btn btn-broadcast';
            btn.dataset.playerName = opt.name;
            btn.innerHTML = `<span class="option-letter">${String.fromCharCode(65 + index)}</span><span class="option-name">${opt.name}</span>`;
            btn.addEventListener('click', () => this.handleMCQSelection(btn, opt.name));
            this.UI.guessMcqOptions.appendChild(btn);
        });

        const btnRevealClue = document.getElementById('btn-reveal-clue');
        if (btnRevealClue) {
            btnRevealClue.className = 'btn btn-secondary btn-broadcast';
            btnRevealClue.classList.remove('hidden');
        }
        this.UI.btnSkipGuess.classList.add('btn-broadcast');
        this.UI.btnSkipGuess.classList.remove('hidden');
        this.UI.btnNextGuess.classList.add('btn-broadcast');
        this.UI.btnNextGuess.classList.add('hidden');
    }

    async handleMCQSelection(selectedBtn, playerName) {
        const allOptionBtns = this.UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
        allOptionBtns.forEach(btn => btn.disabled = true);

        const result = this.currentGame.submitGuess(playerName);

        if (result.correct) {
            selectedBtn.classList.add('correct');

            // Reveal all clues with a sequenced animation
            const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
            const revealPromises = Array.from(clueCards).map((card, i) => {
                const clue = this.currentGame._roundClues?.[i];
                if (clue) {
                    card.querySelector('.clue-back').innerHTML = `<div class="clue-icon">${getIcon(clue.iconKey)}</div><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
                    return GameEffects.revealSequence(card);
                }
                return Promise.resolve();
            });
            await Promise.all(revealPromises);

            GameEffects.flash('aura-success');
            this.showToast(`Goal! ${result.correctAnswer} is correct!`, 'success');

            this.streak = (this.streak || 0) + 1;
            if (this.streak >= 5) {
                this.UI.gameContainer.classList.add('streak-fire');
                this.showToast(`🔥 ON FIRE! ${this.streak} STREAK! 🔥`, 'success');
            }

            const currentScoreText = this.UI.guessScoreDisplay.textContent.split(': ')[1] || '0';
            const currentScore = parseInt(currentScoreText.split(' ')[0]) || 0;
            GameEffects.tickValue(this.UI.guessScoreDisplay, currentScore, this.currentGame.currentScore);

        } else {
            selectedBtn.classList.add('incorrect');
            allOptionBtns.forEach(btn => {
                if (btn.dataset.playerName.toLowerCase() === result.correctAnswer.toLowerCase()) {
                    btn.classList.add('correct');
                }
            });

            this.streak = 0;
            this.UI.gameContainer.classList.remove('streak-fire');

            GameEffects.shake(document.body);
            GameEffects.flash('aura-error');
            this.showToast(`Off target! It was ${result.correctAnswer}.`, 'error');
        }

        this.endGuessRound(result.correct);
    }

    endGuessRound(correct) {
        this.UI.guessScoreDisplay.textContent = `Score: ${this.currentGame.currentScore}`;

        const allOptionBtns = this.UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
        allOptionBtns.forEach(btn => {
            btn.disabled = true;
            if (!correct && btn.dataset.playerName.toLowerCase() === this.currentGame.currentPlayer.name.toLowerCase()) {
                btn.classList.add('correct');
            }
        });

        const roundClues = this.currentGame.roundClues;
        const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
        clueCards.forEach((card, index) => {
            card.classList.add('revealed');
            card.style.cursor = 'default';
            card.style.boxShadow = 'none';
            const clue = roundClues[index];
            if (clue) {
                card.querySelector('.clue-back').innerHTML = `<span class="icon">${clue.icon}</span><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
            }
        });

        const btnRevealClue = document.getElementById('btn-reveal-clue');
        if (btnRevealClue) btnRevealClue.classList.add('hidden');
        this.UI.btnSkipGuess.classList.add('hidden');
        this.UI.btnNextGuess.classList.remove('hidden');
    }

    renderCriteriaGrid() {
        this.UI.gridScoreDisplay.textContent = `Score: ${this.currentGame.score}/9`;
        this.UI.gridInputArea.classList.add('hidden');

        const grid = this.currentGame.grid;
        this.UI.criteriaGridBoard.innerHTML = '';

        this.UI.criteriaGridBoard.appendChild(this.createGridHeader(''));
        this.UI.criteriaGridBoard.appendChild(this.createGridHeader(grid.colValues[0]));
        this.UI.criteriaGridBoard.appendChild(this.createGridHeader(grid.colValues[1]));
        this.UI.criteriaGridBoard.appendChild(this.createGridHeader(grid.colValues[2]));

        for (let r = 0; r < 3; r++) {
            this.UI.criteriaGridBoard.appendChild(this.createGridHeader(grid.rowValues[r]));
            for (let c = 0; c < 3; c++) {
                const cell = document.createElement('div');
                cell.className = 'grid-cell';
                cell.dataset.row = r;
                cell.dataset.col = c;

                cell.addEventListener('click', (e) => {
                    if (cell.classList.contains('filled')) return;

                    document.querySelectorAll('.grid-cell.active').forEach(el => el.classList.remove('active'));
                    cell.classList.add('active');
                    this.activeGridCell = { row: r, col: c };

                    this.UI.gridInputArea.classList.remove('hidden');

                    if (this.UI.gridMcqOptions) {
                        this.UI.gridMcqOptions.innerHTML = '';
                        const options = this.currentGame.getMCQOptions(r, c);
                        options.forEach(p => {
                            const btn = document.createElement('button');
                            btn.className = 'mcq-option-btn';
                            btn.style.padding = '8px 12px';
                            btn.style.fontSize = '0.85rem';
                            btn.textContent = p.name;
                            btn.addEventListener('click', () => {
                                const result = this.currentGame.submitCell(r, c, p.name);
                                if (result.correct) {
                                    cell.classList.add('filled');
                                    cell.innerHTML = `<span class="player-name">${p.name}</span>`;
                                    this.UI.gridScoreDisplay.textContent = `Score: ${this.currentGame.score}/9`;
                                    this.UI.gridInputArea.classList.add('hidden');
                                    if (this.currentGame.isComplete) this.showResults();
                                }
                            });
                        });
                    }

                    const rect = cell.getBoundingClientRect();
                    const boardRect = this.UI.criteriaGridBoard.getBoundingClientRect();
                    this.UI.gridInputArea.style.top = `${rect.bottom - boardRect.top + 10}px`;
                    this.UI.gridInputArea.style.left = '50%';
                    this.UI.gridInputArea.style.transform = 'translateX(-50%)';
                    this.UI.gridPlayerInput.focus();
                });

                this.UI.criteriaGridBoard.appendChild(cell);
            }
        }

        this.currentGame.startTimer(
            (timeLeft) => {
                const min = Math.floor(timeLeft / 60).toString().padStart(2, '0');
                const sec = (timeLeft % 60).toString().padStart(2, '0');
                this.UI.gridTimer.textContent = `Time: ${min}:${sec}`;
            },
            () => {
                this.showToast("Time's up!", 'warning');
                this.showResults();
            }
        );
    }

    createGridHeader(text) {
        const el = document.createElement('div');
        el.className = 'grid-header';
        el.textContent = text;
        return el;
    }

    handleHigherLowerGuess(choice) {
        if (!this.currentGame || this.currentGameType !== 'higher-lower') return;

        const result = this.currentGame.makeGuess(choice);
        if (!result) return;

        this.UI.hlRightVal.textContent = formatStatValue(result.rightValue, result.metric);
        this.UI.hlGuessBox.classList.add('hidden');
        this.UI.hlRightStatBox.classList.remove('hidden');

        if (result.correct) {
            this.showToast(`Correct! Streak is now ${result.streak} 🔥`, 'success');
            this.UI.hlStreakDisplay.textContent = `Streak: ${result.streak}`;
            this.UI.btnHlNext.classList.add('hidden'); // Fixed: should be hidden when result shown
            this.UI.btnHlNext.classList.remove('hidden');
        } else {
            this.showToast(`Wrong! ${this.currentGame.rightPlayer.name} has ${formatStatValue(result.rightValue, result.metric)} ${result.metric.unit}.`, 'error');
            setTimeout(() => {
                this.showResults();
            }, 2000);
        }
    }

    renderHigherLowerRound() {
        if (!this.currentGame || this.currentGameType !== 'higher-lower') {
            return;
        }

        this.UI.hlMetricLabel.textContent = `Comparing ${this.currentGame.metric.label}`;
        this.UI.hlStreakDisplay.textContent = `Streak: ${this.currentGame.streak}`;

        const left = this.currentGame.leftPlayer;
        const right = this.currentGame.rightPlayer;

        this.UI.hlLeftName.textContent = left.name;
        this.UI.hlLeftMeta.textContent = `${left.position} | ${left.nationality}`;
        this.UI.hlLeftVal.textContent = formatStatValue(this.currentGame.getStatValue(left), this.currentGame.metric);
        this.UI.hlLeftUnit.textContent = this.currentGame.metric.id === 'marketValue' || this.currentGame.metric.id === 'shirtNumber' ? '' : this.currentGame.metric.unit;

        this.UI.hlRightName.textContent = right.name;
        this.UI.hlRightMeta.textContent = `${right.position} | ${right.nationality}`;
        this.UI.hlRightVal.textContent = '?';
        this.UI.hlRightUnit.textContent = this.currentGame.metric.id === 'marketValue' || this.currentGame.metric.id === 'shirtNumber' ? '' : this.currentGame.metric.unit;

        this.UI.hlGuessBox.classList.remove('hidden');
        this.UI.hlRightStatBox.classList.add('hidden');
        this.UI.btnHlNext.classList.add('hidden');
    }

    async handleMCQSelection(selectedBtn, playerName) {
        const allOptionBtns = this.UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
        allOptionBtns.forEach(btn => btn.disabled = true);

        const result = this.currentGame.submitGuess(playerName);

        if (result.correct) {
            selectedBtn.classList.add('correct');

            // Reveal all clues with a sequenced animation
            const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
            const revealPromises = Array.from(clueCards).map((card, i) => {
                const clue = this.currentGame._roundClues?.[i];
                if (clue) {
                    card.querySelector('.clue-back').innerHTML = `<div class="clue-icon">${getIcon(clue.iconKey)}</div><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
                    return GameEffects.revealSequence(card);
                }
                return Promise.resolve();
            });
            await Promise.all(revealPromises);

            GameEffects.flash('aura-success');
            this.showToast(`Goal! ${result.correctAnswer} is correct!`, 'success');

            this.streak = (this.streak || 0) + 1;
            if (this.streak >= 5) {
                this.UI.gameContainer.classList.add('streak-fire');
                this.showToast(`🔥 ON FIRE! ${this.streak} STREAK! 🔥`, 'success');
            }

            const currentScoreText = this.UI.guessScoreDisplay.textContent.split(': ')[1] || '0';
            const currentScore = parseInt(currentScoreText.split(' ')[0]) || 0;
            GameEffects.tickValue(this.UI.guessScoreDisplay, currentScore, this.currentGame.currentScore);

        } else {
            selectedBtn.classList.add('incorrect');
            allOptionBtns.forEach(btn => {
                if (btn.dataset.playerName.toLowerCase() === result.correctAnswer.toLowerCase()) {
                    btn.classList.add('correct');
                }
            });

            this.streak = 0;
            this.UI.gameContainer.classList.remove('streak-fire');

            GameEffects.shake(document.body);
            GameEffects.flash('aura-error');
            this.showToast(`Off target! It was ${result.correctAnswer}.`, 'error');
        }

        this.endGuessRound(result.correct);
    }

    endGuessRound(correct) {
        this.UI.guessScoreDisplay.textContent = `Score: ${this.currentGame.currentScore}`;

        const allOptionBtns = this.UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
        allOptionBtns.forEach(btn => {
            btn.disabled = true;
            if (!correct && btn.dataset.playerName.toLowerCase() === this.currentGame.currentPlayer.name.toLowerCase()) {
                btn.classList.add('correct');
            }
        });

        const roundClues = this.currentGame.roundClues;
        const clueCards = this.UI.guessClueCards.querySelectorAll('.clue-card');
        clueCards.forEach((card, index) => {
            card.classList.add('revealed');
            card.style.cursor = 'default';
            card.style.boxShadow = 'none';
            const clue = card.querySelector('.clue-back');
            if (clue) {
                clue.innerHTML = `<span class="icon">${clue.icon}</span><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
            }
        });

        const btnRevealClue = document.getElementById('btn-reveal-clue');
        if (btnRevealClue) btnRevealClue.classList.add('hidden');
        this.UI.btnSkipGuess.classList.add('hidden');
        this.UI.btnNextGuess.classList.remove('hidden');
    }

    showResults() {
        if (this.currentGameType === 'criteria-grid') {
            this.currentGame.stopTimer();
        }

        const results = this.currentGame.getResults();
        this.UI.finalScore.textContent = results.score !== undefined ? results.score : results.totalScore;

        if (this.UI.identitySummary) {
            const scopeName = this.activeScope ? this.activeScope.name : "Quick Play";
            const summary = this.activeScope ? getScopeSummary(this.activeScope) : "All Leagues, All Eras";
            this.UI.identitySummary.textContent = `${scopeName} (${summary})`;
        }

        if (this.currentGameType === 'guess-player') {
            const correctCount = results.rounds ? results.rounds.filter(r => r.guessedCorrectly).length : 0;
            this.UI.resultsSummary.textContent = `You guessed ${correctCount} out of 10 players correctly.`;
            this.UI.resultsProgress.style.width = `${(results.totalScore / 60) * 100}%`;
        } else if (this.currentGameType === 'higher-lower') {
            this.UI.resultsSummary.textContent = `You achieved a streak of ${results.totalScore} in ${results.metricLabel}!`;
            this.UI.resultsProgress.style.width = `${Math.min(results.totalScore * 10, 100)}%`;
        } else {
            this.UI.resultsSummary.textContent = `You correctly filled ${results.score} out of 9 cells.`;
            this.UI.resultsProgress.style.width = `${(results.score / 9) * 100}%`;
        }

        createConfetti(document.body);
        window.location.hash = '#results';
    }

    showToast(message, type = 'info') {
        if (!this.UI.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        this.UI.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    setupAutocomplete(inputEl, listEl, _pool, onSelect, customSource = null) {
        inputEl.addEventListener('input', debounce((e) => {
            const query = e.target.value;
            listEl.innerHTML = '';
            if (!query) return;

            let results = [];
            if (customSource) {
                const source = customSource();
                results = source.filter(i => i.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
            } else {
                results = searchPlayers(query, this.currentPool);
            }

            results.forEach(item => {
                const div = document.createElement('div');
                div.className = 'autocomplete-item';
                div.textContent = item.name;
                div.addEventListener('click', () => {
                    inputEl.value = item.name;
                    listEl.innerHTML = '';
                    onSelect(item.name);
                });
                listEl.appendChild(div);
            });
        }, 300));

        document.addEventListener('click', (e) => {
            if (e.target !== inputEl && e.target !== listEl) {
                listEl.innerHTML = '';
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    window.app = app;
    app.init();
});

window.addEventListener('hashchange', () => {
    const appInstance = window.app; // This is a bit tricky without a global
    if (appInstance) {
        appInstance.navigate(window.location.hash || '#home');
    } else {
        // For now, we'll keep the listener outside the class
        // We'll need a way to reference the app instance
    }
});
