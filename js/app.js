import { loadData, getAllPlayers, getPlayersByScope, searchPlayers, getTeams, getNationalities } from './data.js';
import { createScope, saveScope, loadScopes, deleteScope, getScopeSummary, validateScope, createQuickPlayScope } from './scope.js';
import { GuessPlayerGame } from './guess-player.js';
import { CriteriaGridGame } from './criteria-grid.js';
import { createConfetti, debounce } from './utils.js';

let activeScope = null;
let currentGame = null;
let currentGameType = null;
let currentView = 'home';
let scopeBuilderState = { leagues: new Set(), start: 2000, end: 2024, teams: [], nationalities: [] };
let activeGridCell = null;
let playerPool = [];
let currentPool = [];

// DOM Elements
const views = {
  home: document.getElementById('home-view'),
  'format-picker': document.getElementById('format-picker-view'),
  'guess-player': document.getElementById('guess-player-view'),
  'criteria-grid': document.getElementById('criteria-grid-view'),
  results: document.getElementById('results-view')
};

const UI = {
  scopeBuilder: document.getElementById('scope-builder'),
  formatGuessPlayer: document.getElementById('format-guess-player'),
  formatCriteriaGrid: document.getElementById('format-criteria-grid'),
  btnBackFormats: document.getElementById('btn-back-formats'),
  
  guessRoundCounter: document.getElementById('guess-round-counter'),
  guessScoreDisplay: document.getElementById('guess-score-display'),
  guessClueCards: document.getElementById('guess-clue-cards'),
  guessMcqOptions: document.getElementById('guess-mcq-options'),
  btnSkipGuess: document.getElementById('btn-skip-guess'),
  btnNextGuess: document.getElementById('btn-next-guess'),
  
  gridTimer: document.getElementById('grid-timer'),
  gridScoreDisplay: document.getElementById('grid-score-display'),
  criteriaGridBoard: document.getElementById('criteria-grid-board'),
  gridInputArea: document.getElementById('grid-input-area'),
  gridPlayerInput: document.getElementById('grid-player-input'),
  gridAutocompleteList: document.getElementById('grid-autocomplete-list'),
  btnNewGrid: document.getElementById('btn-new-grid'),
  btnBackGrid: document.getElementById('btn-back-grid'),
  
  finalScore: document.getElementById('final-score'),
  resultsProgress: document.getElementById('results-progress'),
  resultsSummary: document.getElementById('results-summary'),
  btnPlayAgain: document.getElementById('btn-play-again'),
  btnResultsHome: document.getElementById('btn-results-home'),
  
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
  nationalityDropdown: document.getElementById('nationality-dropdown'),
  
  savedScopesList: document.getElementById('saved-scopes-list'),
  btnQuickPlay: document.getElementById('btn-quick-play'),
  btnCreateScope: document.getElementById('btn-create-scope'),
  toastContainer: document.getElementById('toast-container')
};

const LEAGUE_MAP = {
  'premier-league': 'Premier League',
  'la-liga': 'La Liga',
  'bundesliga': 'Bundesliga',
  'serie-a': 'Serie A',
  'ligue-1': 'Ligue 1'
};

document.addEventListener('DOMContentLoaded', async () => {
  playerPool = await loadData();
  currentPool = playerPool;
  setupEventListeners();
  renderHome();
  navigate(window.location.hash || '#home');
});

window.addEventListener('hashchange', () => {
  navigate(window.location.hash || '#home');
});

function navigate(hash) {
  const viewName = hash.replace('#', '');
  if (!views[viewName]) return;
  
  Object.values(views).forEach(v => {
    if (v) v.classList.remove('active');
  });
  
  views[viewName].classList.add('active');
  currentView = viewName;
  
  if (viewName === 'home') renderHome();
}

function setupEventListeners() {
  // Navigation
  UI.btnQuickPlay.addEventListener('click', () => {
    activeScope = createQuickPlayScope();
    currentPool = playerPool;
    window.location.hash = '#format-picker';
  });
  
  UI.btnBackFormats.addEventListener('click', () => {
    window.location.hash = '#home';
  });
  
  UI.btnPlayAgain.addEventListener('click', () => {
    startFormat(currentGameType);
  });
  
  UI.btnResultsHome.addEventListener('click', () => {
    window.location.hash = '#home';
  });

  // Scope Builder
  UI.btnCreateScope.addEventListener('click', () => {
    scopeBuilderState = { leagues: new Set(), start: 2020, end: 2025, teams: [], nationalities: [] };
    UI.leagueBadges.forEach(b => b.classList.remove('selected'));
    UI.eraStart.value = 2020;
    UI.eraEnd.value = 2025;
    UI.eraStartLabel.textContent = 2020;
    UI.eraEndLabel.textContent = 2025;
    UI.scopeName.value = '';
    UI.teamSearch.value = '';
    UI.nationalitySearch.value = '';
    updateScopePreview();
    UI.scopeBuilder.classList.add('active');
  });

  UI.btnCancelScope.addEventListener('click', () => {
    UI.scopeBuilder.classList.remove('active');
  });

  UI.leagueBadges.forEach(badge => {
    badge.addEventListener('click', () => {
      const league = badge.dataset.league;
      if (scopeBuilderState.leagues.has(league)) {
        scopeBuilderState.leagues.delete(league);
        badge.classList.remove('selected');
      } else {
        scopeBuilderState.leagues.add(league);
        badge.classList.add('selected');
      }
      updateScopePreview();
    });
  });

  const syncEras = () => {
    const s = parseInt(UI.eraStart.value);
    const e = parseInt(UI.eraEnd.value);
    if (s > e) {
      UI.eraStart.value = e;
      UI.eraEnd.value = s;
    }
    scopeBuilderState.start = parseInt(UI.eraStart.value);
    scopeBuilderState.end = parseInt(UI.eraEnd.value);
    UI.eraStartLabel.textContent = UI.eraStart.value;
    UI.eraEndLabel.textContent = UI.eraEnd.value;
    updateScopePreview();
  };
  
  UI.eraStart.addEventListener('input', syncEras);
  UI.eraEnd.addEventListener('input', syncEras);

  UI.btnSaveScope.addEventListener('click', () => {
    const name = UI.scopeName.value.trim() || 'Custom Scope';
    const filters = [];
    
    if (scopeBuilderState.leagues.size > 0) {
      scopeBuilderState.leagues.forEach(l => {
        filters.push({ league: LEAGUE_MAP[l], seasonStart: scopeBuilderState.start, seasonEnd: scopeBuilderState.end });
      });
    } else {
      Object.values(LEAGUE_MAP).forEach(l => {
        filters.push({ league: l, seasonStart: scopeBuilderState.start, seasonEnd: scopeBuilderState.end });
      });
    }
    
    const scope = createScope(name, filters, scopeBuilderState.teams, scopeBuilderState.nationalities);
    const pool = getPlayersByScope(scope);
    const validation = validateScope(scope, pool);
    
    if (!validation.valid) {
      showToast(validation.message, 'error');
      return;
    }
    
    saveScope(scope);
    UI.scopeBuilder.classList.remove('active');
    renderHome();
  });

  // Autocomplete setup for scope builder
  setupAutocomplete(UI.teamSearch, UI.teamDropdown, playerPool, (teamName) => {
    if (!scopeBuilderState.teams.includes(teamName)) {
      scopeBuilderState.teams.push(teamName);
      updateScopePreview();
      showToast(`Added team: ${teamName}`);
    }
    UI.teamSearch.value = '';
  }, () => {
    const selectedLeagues = Array.from(scopeBuilderState.leagues).map(l => LEAGUE_MAP[l]);
    let teams = [];
    if (selectedLeagues.length > 0) {
      selectedLeagues.forEach(l => teams = teams.concat(getTeams(l)));
    } else {
      teams = getTeams();
    }
    return teams.map(t => ({ name: t })); // Mock player object for autocomplete
  });

  setupAutocomplete(UI.nationalitySearch, UI.nationalityDropdown, playerPool, (natName) => {
    if (!scopeBuilderState.nationalities.includes(natName)) {
      scopeBuilderState.nationalities.push(natName);
      updateScopePreview();
      showToast(`Added nationality: ${natName}`);
    }
    UI.nationalitySearch.value = '';
  }, () => getNationalities().map(n => ({ name: n })));

  // Format selection
  UI.formatGuessPlayer.addEventListener('click', () => startFormat('guess-player'));
  UI.formatCriteriaGrid.addEventListener('click', () => startFormat('criteria-grid'));

  // Guess Player
  const btnRevealClue = document.getElementById('btn-reveal-clue');
  if (btnRevealClue) {
    btnRevealClue.addEventListener('click', () => {
      if (!currentGame || currentGame.cluesRemaining <= 0) return;
      const clueCards = UI.guessClueCards.querySelectorAll('.clue-card');
      const idx = currentGame._currentCluesRevealed;
      const clue = currentGame.revealNextClue();
      if (clue && clueCards[idx]) {
        clueCards[idx].classList.add('revealed');
        const back = clueCards[idx].querySelector('.clue-back');
        back.innerHTML = `<span class="icon">${clue.icon}</span><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
        UI.guessScoreDisplay.textContent = `Score: ${currentGame.currentScore} (Max: ${currentGame.maxPossibleScore})`;
        // Update cursor highlights
        clueCards.forEach((card, i) => {
          if (!card.classList.contains('revealed') && i === currentGame._currentCluesRevealed) {
            card.style.cursor = 'pointer';
            card.style.boxShadow = '0 0 10px rgba(0, 230, 118, 0.5)';
          } else if (!card.classList.contains('revealed')) {
            card.style.cursor = 'default';
            card.style.boxShadow = 'none';
          }
        });
      }
    });
  }
  UI.btnSkipGuess.addEventListener('click', () => {
    currentGame.skipRound();
    endGuessRound(false);
  });
  UI.btnNextGuess.addEventListener('click', () => {
    if (currentGame.nextRound()) {
      renderGuessRound();
    } else {
      showResults();
    }
  });

  // Setup Clue Cards click
  const clueCards = UI.guessClueCards.querySelectorAll('.clue-card');
  clueCards.forEach((card, index) => {
    card.addEventListener('click', () => {
      if (!card.classList.contains('revealed') && index === currentGame._currentCluesRevealed) {
        const clue = currentGame.revealNextClue();
        if (clue) {
          card.classList.add('revealed');
          const back = card.querySelector('.clue-back');
          back.innerHTML = `<span class="icon">${clue.icon}</span><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
          UI.guessScoreDisplay.textContent = `Score: ${currentGame.currentScore} (Max: ${currentGame.maxPossibleScore})`;
        }
      }
    });
  });

  // Criteria Grid
  UI.btnNewGrid.addEventListener('click', () => startFormat('criteria-grid'));
  UI.btnBackGrid.addEventListener('click', () => window.location.hash = '#format-picker');

  setupAutocomplete(UI.gridPlayerInput, UI.gridAutocompleteList, null, (playerName) => {
    if (activeGridCell) {
      const { row, col } = activeGridCell;
      const result = currentGame.submitCell(row, col, playerName);
      if (result.alreadyUsed) {
        showToast('Player already used!', 'warning');
      } else if (result.correct) {
        const cellEl = UI.criteriaGridBoard.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
        cellEl.classList.add('filled');
        cellEl.innerHTML = `<span class="player-name">${playerName}</span>`;
        UI.gridScoreDisplay.textContent = `Score: ${currentGame.score}/9`;
        UI.gridInputArea.classList.add('hidden');
        if (currentGame.isComplete) showResults();
      } else {
        const cellEl = UI.criteriaGridBoard.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
        cellEl.classList.add('incorrect');
        setTimeout(() => cellEl.classList.remove('incorrect'), 500);
        showToast('Incorrect player!', 'error');
      }
      UI.gridPlayerInput.value = '';
    }
  });
}

function updateScopePreview() {
  const filters = [];
  if (scopeBuilderState.leagues.size > 0) {
    scopeBuilderState.leagues.forEach(l => {
      filters.push({ league: LEAGUE_MAP[l], seasonStart: scopeBuilderState.start, seasonEnd: scopeBuilderState.end });
    });
  } else {
    Object.values(LEAGUE_MAP).forEach(l => {
      filters.push({ league: l, seasonStart: scopeBuilderState.start, seasonEnd: scopeBuilderState.end });
    });
  }
  
  const scope = createScope("Preview", filters, scopeBuilderState.teams, scopeBuilderState.nationalities);
  const matched = getPlayersByScope(scope);
  
  if (UI.scopePoolCount) UI.scopePoolCount.textContent = matched.length;
  if (UI.scopePoolPreview) {
    const sample = matched.sort(() => 0.5 - Math.random()).slice(0, 5).map(p => p.name).join(', ');
    UI.scopePoolPreview.textContent = sample || 'No players found.';
  }
}

function renderHome() {
  const scopes = loadScopes();
  UI.savedScopesList.innerHTML = '';
  
  scopes.forEach(scope => {
    const card = document.createElement('div');
    card.className = 'card scope-card';
    const summary = getScopeSummary(scope);
    
    card.innerHTML = `
      <h3>${scope.name}</h3>
      <p class="text-sm text-secondary mt-1">${summary}</p>
      <div class="flex gap-2 mt-3">
        <button class="btn btn-primary flex-1 btn-play-scope">Play</button>
        <button class="btn btn-secondary btn-delete-scope">Delete</button>
      </div>
    `;
    
    card.querySelector('.btn-play-scope').addEventListener('click', () => {
      activeScope = scope;
      currentPool = getPlayersByScope(activeScope);
      window.location.hash = '#format-picker';
    });
    
    card.querySelector('.btn-delete-scope').addEventListener('click', () => {
      deleteScope(scope.id);
      renderHome();
    });
    
    UI.savedScopesList.appendChild(card);
  });
}

function setupAutocomplete(inputEl, listEl, _pool, onSelect, customSource = null) {
  inputEl.addEventListener('input', debounce((e) => {
    const query = e.target.value;
    listEl.innerHTML = '';
    if (!query) return;
    
    let results = [];
    if (customSource) {
      const source = customSource();
      results = source.filter(i => i.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
    } else {
      results = searchPlayers(query, currentPool);
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
  
  // Close autocomplete on outside click
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl && e.target !== listEl) {
      listEl.innerHTML = '';
    }
  });
}

function startFormat(format) {
  currentGameType = format;
  if (format === 'guess-player') {
    try {
      currentGame = new GuessPlayerGame(currentPool);
      renderGuessRound();
      window.location.hash = '#guess-player';
    } catch (e) {
      showToast(e.message, 'error');
    }
  } else if (format === 'criteria-grid') {
    try {
      currentGame = new CriteriaGridGame(currentPool, { timerEnabled: true, timerDuration: 300 });
      renderCriteriaGrid();
      window.location.hash = '#criteria-grid';
    } catch (e) {
      showToast(e.message, 'error');
    }
  }
}

function renderGuessRound() {
  UI.guessRoundCounter.textContent = `Round ${currentGame.currentRound}/${currentGame.totalRounds}`;
  UI.guessScoreDisplay.textContent = `Score: ${currentGame.currentScore} (Max: ${currentGame.maxPossibleScore})`;
  
  const clueCards = UI.guessClueCards.querySelectorAll('.clue-card');
  clueCards.forEach((card, index) => {
    card.classList.remove('revealed');
    card.querySelector('.clue-front').innerHTML = `<span>?</span>`;
    card.querySelector('.clue-back').innerHTML = '';
    // Highlight the next available card to indicate it's clickable
    if (index === 0) {
      card.style.cursor = 'pointer';
      card.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.5)';
    } else {
      card.style.cursor = 'default';
      card.style.boxShadow = 'none';
    }
  });
  
  // Render MCQ Options
  const options = currentGame.getMCQOptions();
  UI.guessMcqOptions.innerHTML = '';
  options.forEach((opt, index) => {
    const btn = document.createElement('button');
    btn.className = 'mcq-option-btn';
    btn.dataset.playerName = opt.name;
    btn.innerHTML = `<span class="option-letter">${String.fromCharCode(65 + index)}</span><span class="option-name">${opt.name}</span>`;
    btn.addEventListener('click', () => handleMCQSelection(btn, opt.name));
    UI.guessMcqOptions.appendChild(btn);
  });
  
  const btnRevealClue = document.getElementById('btn-reveal-clue');
  if (btnRevealClue) btnRevealClue.classList.remove('hidden');
  UI.btnSkipGuess.classList.remove('hidden');
  UI.btnNextGuess.classList.add('hidden');
}

function handleMCQSelection(selectedBtn, playerName) {
  const allOptionBtns = UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
  allOptionBtns.forEach(btn => btn.disabled = true);

  const result = currentGame.submitGuess(playerName);
  if (result.correct) {
    selectedBtn.classList.add('correct');
    showToast(`Correct! Earned ${result.pointsEarned} points.`, 'success');
  } else {
    selectedBtn.classList.add('incorrect');
    allOptionBtns.forEach(btn => {
      if (btn.dataset.playerName.toLowerCase() === result.correctAnswer.toLowerCase()) {
        btn.classList.add('correct');
      }
    });
    showToast(`Incorrect! It was ${result.correctAnswer}.`, 'error');
  }
  
  endGuessRound(result.correct);
}

function endGuessRound(correct) {
  UI.guessScoreDisplay.textContent = `Score: ${currentGame.currentScore}`;
  
  const allOptionBtns = UI.guessMcqOptions.querySelectorAll('.mcq-option-btn');
  allOptionBtns.forEach(btn => {
    btn.disabled = true;
    if (!correct && btn.dataset.playerName.toLowerCase() === currentGame.currentPlayer.name.toLowerCase()) {
      btn.classList.add('correct');
    }
  });

  // Reveal all clues to show the player
  const allClues = currentGame._generateClues(currentGame.currentPlayer);
  const clueCards = UI.guessClueCards.querySelectorAll('.clue-card');
  clueCards.forEach((card, index) => {
    card.classList.add('revealed');
    card.style.cursor = 'default';
    card.style.boxShadow = 'none';
    const clue = allClues[index];
    if (clue) {
      card.querySelector('.clue-back').innerHTML = `<span class="icon">${clue.icon}</span><span class="text text-sm" style="text-align: center;">${clue.value}</span>`;
    }
  });

  const btnRevealClue = document.getElementById('btn-reveal-clue');
  if (btnRevealClue) btnRevealClue.classList.add('hidden');
  UI.btnSkipGuess.classList.add('hidden');
  UI.btnNextGuess.classList.remove('hidden');
}

function renderCriteriaGrid() {
  UI.gridScoreDisplay.textContent = `Score: ${currentGame.score}/9`;
  UI.gridInputArea.classList.add('hidden');
  
  const grid = currentGame.grid;
  UI.criteriaGridBoard.innerHTML = '';
  
  // Header row
  UI.criteriaGridBoard.appendChild(createGridHeader(''));
  UI.criteriaGridBoard.appendChild(createGridHeader(grid.colValues[0]));
  UI.criteriaGridBoard.appendChild(createGridHeader(grid.colValues[1]));
  UI.criteriaGridBoard.appendChild(createGridHeader(grid.colValues[2]));
  
  // Data rows
  for (let r = 0; r < 3; r++) {
    UI.criteriaGridBoard.appendChild(createGridHeader(grid.rowValues[r]));
    for (let c = 0; c < 3; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      
      cell.addEventListener('click', (e) => {
        if (cell.classList.contains('filled')) return;
        
        document.querySelectorAll('.grid-cell.active').forEach(el => el.classList.remove('active'));
        cell.classList.add('active');
        activeGridCell = { row: r, col: c };
        
        UI.gridInputArea.classList.remove('hidden');
        
        // Position input area near the cell
        const rect = cell.getBoundingClientRect();
        const boardRect = UI.criteriaGridBoard.getBoundingClientRect();
        UI.gridInputArea.style.top = `${rect.bottom - boardRect.top + 10}px`;
        UI.gridInputArea.style.left = '50%';
        UI.gridInputArea.style.transform = 'translateX(-50%)';
        
        UI.gridPlayerInput.focus();
      });
      
      UI.criteriaGridBoard.appendChild(cell);
    }
  }

  currentGame.startTimer(
    (timeLeft) => {
      const min = Math.floor(timeLeft / 60).toString().padStart(2, '0');
      const sec = (timeLeft % 60).toString().padStart(2, '0');
      UI.gridTimer.textContent = `Time: ${min}:${sec}`;
    },
    () => {
      showToast("Time's up!", 'warning');
      showResults();
    }
  );
}

function createGridHeader(text) {
  const el = document.createElement('div');
  el.className = 'grid-header';
  el.textContent = text;
  return el;
}

function showResults() {
  if (currentGameType === 'criteria-grid') {
    currentGame.stopTimer();
  }
  
  const results = currentGame.getResults();
  UI.finalScore.textContent = results.score || results.totalScore;
  const maxScore = results.maxScore;
  const percentage = maxScore > 0 ? ((results.score || results.totalScore) / maxScore) * 100 : 0;
  
  UI.resultsProgress.style.width = `${percentage}%`;
  
  if (currentGameType === 'guess-player') {
    const correctCount = results.rounds.filter(r => r.guessedCorrectly).length;
    UI.resultsSummary.textContent = `You guessed ${correctCount} out of 10 players correctly.`;
  } else {
    UI.resultsSummary.textContent = `You correctly filled ${results.score} out of 9 cells.`;
  }
  
  createConfetti(document.body);
  window.location.hash = '#results';
}

function showToast(message, type = 'info') {
  if (!UI.toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  
  UI.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Update clue card highlighting during game
document.addEventListener('click', () => {
  if (currentView === 'guess-player' && currentGame) {
    const clueCards = UI.guessClueCards.querySelectorAll('.clue-card');
    const currentIndex = currentGame._currentCluesRevealed;
    clueCards.forEach((card, index) => {
      if (!card.classList.contains('revealed')) {
        if (index === currentIndex) {
          card.style.cursor = 'pointer';
          card.style.boxShadow = '0 0 10px rgba(76, 175, 80, 0.5)';
        } else {
          card.style.cursor = 'default';
          card.style.boxShadow = 'none';
        }
      }
    });
  }
});
