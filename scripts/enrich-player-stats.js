/**
 * enrich-player-stats.js
 * 
 * Enriches the players.json dataset with:
 * 1. Curated stats for well-known players (goals, caps, trophies, market value, etc.)
 * 2. Reasonable estimated stats for lesser-known players based on position/team
 * 3. Gold standard player integration
 * 4. Deduplication of team entries
 * 5. Correct team assignments where possible
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLAYERS_JSON = path.join(__dirname, '../data/players.json');
const GOLD_STANDARD_JSON = path.join(__dirname, '../data/gold_standard.json');

// ============================================================================
// CURATED STATS DATABASE
// Sourced from public football knowledge (Wikipedia, Transfermarkt-level data)
// Market values in millions EUR, caps = international appearances
// ============================================================================
const CURATED_STATS = {
  // === ARSENAL ===
  "Bukayo Saka": { shirtNumber: 7, marketValue: 140, caps: 45, careerGoals: 75, trophies: [], preferredFoot: "Left" },
  "Martin Ødegaard": { shirtNumber: 8, marketValue: 120, caps: 65, careerGoals: 40, trophies: [], preferredFoot: "Left" },
  "Declan Rice": { shirtNumber: 41, marketValue: 110, caps: 55, careerGoals: 15, trophies: [], preferredFoot: "Right" },
  "William Saliba": { shirtNumber: 2, marketValue: 100, caps: 20, careerGoals: 5, trophies: [], preferredFoot: "Right" },
  "Gabriel Jesus": { shirtNumber: 9, marketValue: 50, caps: 60, careerGoals: 120, trophies: ["Premier League (4)"], preferredFoot: "Right" },
  "Ben White": { shirtNumber: 4, marketValue: 55, caps: 4, careerGoals: 5, trophies: [], preferredFoot: "Right" },
  "Gabriel Martinelli": { shirtNumber: 11, marketValue: 65, caps: 15, careerGoals: 45, trophies: [], preferredFoot: "Left" },
  "Aaron Ramsdale": { shirtNumber: 1, marketValue: 25, caps: 5, careerGoals: 0, trophies: [], preferredFoot: "Right" },
  "David Raya": { shirtNumber: 22, marketValue: 35, caps: 5, careerGoals: 0, trophies: [], preferredFoot: "Right" },
  "Kai Havertz": { shirtNumber: 29, marketValue: 65, caps: 50, careerGoals: 55, trophies: ["Champions League"], preferredFoot: "Left" },
  "Leandro Trossard": { shirtNumber: 19, marketValue: 40, caps: 45, careerGoals: 50, trophies: [], preferredFoot: "Left" },
  "Jorginho": { shirtNumber: 20, marketValue: 15, caps: 55, careerGoals: 35, trophies: ["Champions League", "Euros"], preferredFoot: "Right" },
  "Takehiro Tomiyasu": { shirtNumber: 18, marketValue: 25, caps: 35, careerGoals: 2, trophies: [], preferredFoot: "Right" },
  "Gabriel Magalhães": { shirtNumber: 6, marketValue: 75, caps: 10, careerGoals: 20, trophies: [], preferredFoot: "Left" },
  "Oleksandr Zinchenko": { shirtNumber: 35, marketValue: 25, caps: 65, careerGoals: 10, trophies: ["Premier League (4)"], preferredFoot: "Left" },
  "Jakub Kiwior": { shirtNumber: 15, marketValue: 20, caps: 25, careerGoals: 2, trophies: [], preferredFoot: "Left" },
  "Fabio Vieira": { shirtNumber: 21, marketValue: 20, caps: 5, careerGoals: 15, trophies: [], preferredFoot: "Left" },
  "Emile Smith Rowe": { shirtNumber: 10, marketValue: 20, caps: 3, careerGoals: 20, trophies: [], preferredFoot: "Right" },

  // === MANCHESTER CITY ===
  "Erling Haaland": { shirtNumber: 9, marketValue: 180, caps: 35, careerGoals: 250, trophies: ["Premier League", "Champions League"], preferredFoot: "Left" },
  "Kevin De Bruyne": { shirtNumber: 17, marketValue: 60, caps: 105, careerGoals: 100, trophies: ["Premier League (6)", "Champions League"], preferredFoot: "Right" },
  "Phil Foden": { shirtNumber: 47, marketValue: 130, caps: 40, careerGoals: 80, trophies: ["Premier League (6)", "Champions League"], preferredFoot: "Left" },
  "Bernardo Silva": { shirtNumber: 20, marketValue: 80, caps: 90, careerGoals: 60, trophies: ["Premier League (5)", "Champions League"], preferredFoot: "Left" },
  "Rodri": { shirtNumber: 16, marketValue: 130, caps: 65, careerGoals: 30, trophies: ["Premier League", "Champions League", "Euros", "Ballon d'Or"], preferredFoot: "Right" },
  "Jack Grealish": { shirtNumber: 10, marketValue: 45, caps: 35, careerGoals: 25, trophies: ["Premier League", "Champions League"], preferredFoot: "Right" },
  "Ederson": { shirtNumber: 31, marketValue: 35, caps: 25, careerGoals: 0, trophies: ["Premier League (5)", "Champions League"], preferredFoot: "Left" },
  "Rúben Dias": { shirtNumber: 3, marketValue: 75, caps: 55, careerGoals: 5, trophies: ["Premier League", "Champions League"], preferredFoot: "Right" },
  "John Stones": { shirtNumber: 5, marketValue: 30, caps: 75, careerGoals: 10, trophies: ["Premier League (5)", "Champions League"], preferredFoot: "Right" },
  "Kyle Walker": { shirtNumber: 2, marketValue: 15, caps: 80, careerGoals: 3, trophies: ["Premier League (6)", "Champions League"], preferredFoot: "Right" },
  "Nathan Aké": { shirtNumber: 6, marketValue: 35, caps: 40, careerGoals: 10, trophies: ["Premier League", "Champions League"], preferredFoot: "Left" },
  "Mateo Kovačić": { shirtNumber: 8, marketValue: 30, caps: 95, careerGoals: 15, trophies: ["Champions League (2)", "Premier League"], preferredFoot: "Right" },
  "Julián Álvarez": { shirtNumber: 19, marketValue: 90, caps: 35, careerGoals: 60, trophies: ["World Cup", "Premier League", "Champions League"], preferredFoot: "Right" },
  "Jeremy Doku": { shirtNumber: 11, marketValue: 65, caps: 30, careerGoals: 10, trophies: ["Premier League"], preferredFoot: "Right" },

  // === LIVERPOOL ===
  "Mohamed Salah": { shirtNumber: 11, marketValue: 60, caps: 100, careerGoals: 280, trophies: ["Premier League", "Champions League"], preferredFoot: "Left" },
  "Virgil van Dijk": { shirtNumber: 4, marketValue: 30, caps: 70, careerGoals: 15, trophies: ["Premier League", "Champions League"], preferredFoot: "Right" },
  "Trent Alexander-Arnold": { shirtNumber: 66, marketValue: 70, caps: 30, careerGoals: 20, trophies: ["Premier League", "Champions League"], preferredFoot: "Right" },
  "Alisson": { shirtNumber: 1, marketValue: 35, caps: 70, careerGoals: 1, trophies: ["Premier League", "Champions League", "Copa America"], preferredFoot: "Right" },
  "Diogo Jota": { shirtNumber: 20, marketValue: 50, caps: 40, careerGoals: 80, trophies: ["Premier League"], preferredFoot: "Right" },
  "Luis Díaz": { shirtNumber: 7, marketValue: 60, caps: 50, careerGoals: 40, trophies: [], preferredFoot: "Right" },
  "Cody Gakpo": { shirtNumber: 18, marketValue: 55, caps: 35, careerGoals: 40, trophies: [], preferredFoot: "Right" },
  "Darwin Núñez": { shirtNumber: 9, marketValue: 55, caps: 30, careerGoals: 80, trophies: [], preferredFoot: "Right" },
  "Dominik Szoboszlai": { shirtNumber: 8, marketValue: 60, caps: 45, careerGoals: 25, trophies: [], preferredFoot: "Right" },
  "Andrew Robertson": { shirtNumber: 26, marketValue: 20, caps: 75, careerGoals: 5, trophies: ["Premier League", "Champions League"], preferredFoot: "Left" },
  "Alexis Mac Allister": { shirtNumber: 10, marketValue: 65, caps: 40, careerGoals: 15, trophies: ["World Cup"], preferredFoot: "Right" },
  "Ryan Gravenberch": { shirtNumber: 38, marketValue: 40, caps: 15, careerGoals: 5, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Right" },
  "Wataru Endo": { shirtNumber: 3, marketValue: 10, caps: 55, careerGoals: 10, trophies: [], preferredFoot: "Right" },

  // === CHELSEA ===
  "Cole Palmer": { shirtNumber: 20, marketValue: 110, caps: 15, careerGoals: 45, trophies: ["Premier League", "Champions League"], preferredFoot: "Left" },
  "Enzo Fernández": { shirtNumber: 8, marketValue: 60, caps: 30, careerGoals: 10, trophies: ["World Cup"], preferredFoot: "Right" },
  "Raheem Sterling": { shirtNumber: 7, marketValue: 25, caps: 82, careerGoals: 130, trophies: ["Premier League (4)"], preferredFoot: "Right" },
  "Moisés Caicedo": { shirtNumber: 25, marketValue: 80, caps: 40, careerGoals: 5, trophies: [], preferredFoot: "Right" },
  "Reece James": { shirtNumber: 24, marketValue: 35, caps: 15, careerGoals: 10, trophies: ["Champions League"], preferredFoot: "Right" },
  "Nicolas Jackson": { shirtNumber: 15, marketValue: 50, caps: 25, careerGoals: 45, trophies: [], preferredFoot: "Right" },
  "Mykhailo Mudryk": { shirtNumber: 10, marketValue: 30, caps: 35, careerGoals: 10, trophies: [], preferredFoot: "Right" },
  "Noni Madueke": { shirtNumber: 11, marketValue: 55, caps: 10, careerGoals: 25, trophies: [], preferredFoot: "Left" },

  // === MANCHESTER UNITED ===
  "Marcus Rashford": { shirtNumber: 10, marketValue: 55, caps: 60, careerGoals: 140, trophies: ["Europa League"], preferredFoot: "Right" },
  "Bruno Fernandes": { shirtNumber: 8, marketValue: 60, caps: 70, careerGoals: 110, trophies: [], preferredFoot: "Right" },
  "Casemiro": { shirtNumber: 18, marketValue: 15, caps: 75, careerGoals: 35, trophies: ["Champions League (5)", "World Cup Runner-Up"], preferredFoot: "Right" },
  "Rasmus Højlund": { shirtNumber: 11, marketValue: 50, caps: 20, careerGoals: 35, trophies: [], preferredFoot: "Right" },
  "André Onana": { shirtNumber: 24, marketValue: 35, caps: 60, careerGoals: 0, trophies: [], preferredFoot: "Right" },
  "Lisandro Martínez": { shirtNumber: 6, marketValue: 50, caps: 25, careerGoals: 5, trophies: ["World Cup"], preferredFoot: "Left" },
  "Kobbie Mainoo": { shirtNumber: 37, marketValue: 60, caps: 10, careerGoals: 5, trophies: [], preferredFoot: "Right" },
  "Alejandro Garnacho": { shirtNumber: 17, marketValue: 45, caps: 15, careerGoals: 20, trophies: [], preferredFoot: "Left" },

  // === TOTTENHAM ===
  "Heung-Min Son": { shirtNumber: 7, marketValue: 40, caps: 120, careerGoals: 180, trophies: [], preferredFoot: "Right" },
  "James Maddison": { shirtNumber: 10, marketValue: 45, caps: 10, careerGoals: 55, trophies: [], preferredFoot: "Right" },
  "Richarlison": { shirtNumber: 9, marketValue: 40, caps: 50, careerGoals: 85, trophies: ["Copa America"], preferredFoot: "Right" },

  // === ASTON VILLA ===
  "Ollie Watkins": { shirtNumber: 11, marketValue: 55, caps: 15, careerGoals: 90, trophies: [], preferredFoot: "Right" },

  // === NEWCASTLE ===
  "Bruno Guimarães": { shirtNumber: 39, marketValue: 80, caps: 20, careerGoals: 25, trophies: [], preferredFoot: "Right", correctTeam: "Newcastle United" },
  "Alexander Isak": { shirtNumber: 14, marketValue: 85, caps: 50, careerGoals: 60, trophies: [], preferredFoot: "Right" },

  // === REAL MADRID ===
  "Vinícius Júnior": { shirtNumber: 7, marketValue: 200, caps: 35, careerGoals: 100, trophies: ["Champions League (2)", "La Liga"], preferredFoot: "Right" },
  "Jude Bellingham": { shirtNumber: 5, marketValue: 150, caps: 40, careerGoals: 55, trophies: ["Champions League", "La Liga"], preferredFoot: "Right" },
  "Kylian Mbappé": { shirtNumber: 9, marketValue: 180, caps: 85, careerGoals: 300, trophies: ["World Cup", "Ligue 1 (6)"], preferredFoot: "Right" },
  "Toni Kroos": { shirtNumber: 8, marketValue: 20, caps: 114, careerGoals: 40, trophies: ["World Cup", "Champions League (6)"], preferredFoot: "Right" },
  "Luka Modrić": { shirtNumber: 10, marketValue: 8, caps: 175, careerGoals: 35, trophies: ["Champions League (6)", "Ballon d'Or"], preferredFoot: "Right" },
  "Federico Valverde": { shirtNumber: 15, marketValue: 120, caps: 60, careerGoals: 25, trophies: ["Champions League (2)", "La Liga"], preferredFoot: "Right" },
  "Antonio Rüdiger": { shirtNumber: 22, marketValue: 30, caps: 70, careerGoals: 10, trophies: ["Champions League (2)"], preferredFoot: "Right" },
  "Dani Carvajal": { shirtNumber: 2, marketValue: 20, caps: 50, careerGoals: 10, trophies: ["Champions League (6)", "Euros"], preferredFoot: "Right" },
  "Éder Militão": { shirtNumber: 3, marketValue: 50, caps: 25, careerGoals: 5, trophies: ["Champions League", "La Liga"], preferredFoot: "Right" },
  "Thibaut Courtois": { shirtNumber: 1, marketValue: 30, caps: 105, careerGoals: 0, trophies: ["Champions League", "La Liga"], preferredFoot: "Left" },

  // === FC BARCELONA ===
  "Robert Lewandowski": { shirtNumber: 9, marketValue: 15, caps: 155, careerGoals: 650, trophies: ["Champions League", "Bundesliga (10)"], preferredFoot: "Right" },
  "Pedri": { shirtNumber: 8, marketValue: 100, caps: 30, careerGoals: 15, trophies: ["La Liga"], preferredFoot: "Right" },
  "Gavi": { shirtNumber: 6, marketValue: 60, caps: 25, careerGoals: 10, trophies: ["La Liga"], preferredFoot: "Right" },
  "Lamine Yamal": { shirtNumber: 19, marketValue: 150, caps: 25, careerGoals: 15, trophies: ["Euros", "La Liga"], preferredFoot: "Left" },
  "Jules Koundé": { shirtNumber: 23, marketValue: 50, caps: 30, careerGoals: 5, trophies: ["La Liga"], preferredFoot: "Right" },
  "Raphinha": { shirtNumber: 11, marketValue: 60, caps: 25, careerGoals: 40, trophies: ["La Liga"], preferredFoot: "Left" },
  "Frenkie de Jong": { shirtNumber: 21, marketValue: 50, caps: 55, careerGoals: 15, trophies: ["La Liga"], preferredFoot: "Right" },
  "Marc-André ter Stegen": { shirtNumber: 1, marketValue: 25, caps: 40, careerGoals: 0, trophies: ["La Liga (4)"], preferredFoot: "Right" },
  "Ronald Araújo": { shirtNumber: 4, marketValue: 60, caps: 25, careerGoals: 5, trophies: ["La Liga"], preferredFoot: "Right" },

  // === ATLETICO MADRID ===
  "Antoine Griezmann": { shirtNumber: 7, marketValue: 20, caps: 130, careerGoals: 250, trophies: ["World Cup", "Europa League"], preferredFoot: "Left" },
  "Jan Oblak": { shirtNumber: 13, marketValue: 25, caps: 70, careerGoals: 0, trophies: ["La Liga"], preferredFoot: "Right" },
  "Álvaro Morata": { shirtNumber: 9, marketValue: 18, caps: 80, careerGoals: 160, trophies: ["Euros", "Champions League", "La Liga"], preferredFoot: "Right" },

  // === BAYERN MUNICH ===
  "Harry Kane": { shirtNumber: 9, marketValue: 100, caps: 98, careerGoals: 340, trophies: [], preferredFoot: "Right" },
  "Jamal Musiala": { shirtNumber: 42, marketValue: 130, caps: 35, careerGoals: 45, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Right" },
  "Leroy Sané": { shirtNumber: 10, marketValue: 50, caps: 55, careerGoals: 60, trophies: ["Bundesliga", "Premier League"], preferredFoot: "Left" },
  "Joshua Kimmich": { shirtNumber: 6, marketValue: 60, caps: 95, careerGoals: 20, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Right" },
  "Alphonso Davies": { shirtNumber: 19, marketValue: 50, caps: 50, careerGoals: 10, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Left" },
  "Thomas Müller": { shirtNumber: 25, marketValue: 10, caps: 130, careerGoals: 250, trophies: ["World Cup", "Champions League (2)", "Bundesliga (12)"], preferredFoot: "Right" },
  "Leon Goretzka": { shirtNumber: 8, marketValue: 35, caps: 55, careerGoals: 25, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Right" },
  "Serge Gnabry": { shirtNumber: 7, marketValue: 35, caps: 45, careerGoals: 60, trophies: ["Bundesliga", "Champions League"], preferredFoot: "Right" },
  "Manuel Neuer": { shirtNumber: 1, marketValue: 8, caps: 120, careerGoals: 0, trophies: ["World Cup", "Champions League (2)", "Bundesliga (11)"], preferredFoot: "Right" },
  "Dayot Upamecano": { shirtNumber: 2, marketValue: 40, caps: 25, careerGoals: 3, trophies: ["Bundesliga"], preferredFoot: "Right" },
  "Kim Min-jae": { shirtNumber: 3, marketValue: 50, caps: 50, careerGoals: 3, trophies: ["Serie A"], preferredFoot: "Right" },

  // === BORUSSIA DORTMUND ===
  "Marco Reus": { shirtNumber: 11, marketValue: 5, caps: 48, careerGoals: 175, trophies: ["DFB-Pokal"], preferredFoot: "Right" },
  "Niclas Füllkrug": { shirtNumber: 14, marketValue: 25, caps: 20, careerGoals: 100, trophies: [], preferredFoot: "Right" },
  "Gregor Kobel": { shirtNumber: 1, marketValue: 40, caps: 10, careerGoals: 0, trophies: [], preferredFoot: "Right" },
  "Mats Hummels": { shirtNumber: 15, marketValue: 5, caps: 78, careerGoals: 15, trophies: ["World Cup", "Bundesliga"], preferredFoot: "Right" },
  "Julian Brandt": { shirtNumber: 10, marketValue: 30, caps: 45, careerGoals: 40, trophies: [], preferredFoot: "Right" },
  "Karim Adeyemi": { shirtNumber: 27, marketValue: 30, caps: 10, careerGoals: 25, trophies: [], preferredFoot: "Left" },

  // === BAYER LEVERKUSEN ===
  "Florian Wirtz": { shirtNumber: 10, marketValue: 130, caps: 25, careerGoals: 45, trophies: ["Bundesliga"], preferredFoot: "Right" },
  "Granit Xhaka": { shirtNumber: 34, marketValue: 25, caps: 125, careerGoals: 30, trophies: ["Bundesliga"], preferredFoot: "Left" },
  "Jeremie Frimpong": { shirtNumber: 30, marketValue: 45, caps: 10, careerGoals: 20, trophies: ["Bundesliga"], preferredFoot: "Right" },
  "Exequiel Palacios": { shirtNumber: 5, marketValue: 35, caps: 25, careerGoals: 10, trophies: ["Bundesliga", "World Cup"], preferredFoot: "Right" },

  // === RB LEIPZIG ===
  "Dani Olmo": { shirtNumber: 7, marketValue: 60, caps: 40, careerGoals: 25, trophies: ["Euros"], preferredFoot: "Right" },
  "Xavi Simons": { shirtNumber: 10, marketValue: 80, caps: 15, careerGoals: 25, trophies: [], preferredFoot: "Right" },

  // === PSG ===
  "Ousmane Dembélé": { shirtNumber: 10, marketValue: 60, caps: 50, careerGoals: 50, trophies: ["World Cup", "La Liga"], preferredFoot: "Left" },
  "Marquinhos": { shirtNumber: 5, marketValue: 30, caps: 85, careerGoals: 15, trophies: ["Ligue 1 (8)", "Copa America"], preferredFoot: "Right" },
  "Achraf Hakimi": { shirtNumber: 2, marketValue: 55, caps: 75, careerGoals: 15, trophies: ["Ligue 1", "Serie A"], preferredFoot: "Right" },
  "Gianluigi Donnarumma": { shirtNumber: 99, marketValue: 30, caps: 70, careerGoals: 0, trophies: ["Euros", "Ligue 1"], preferredFoot: "Right" },

  // === JUVENTUS ===
  "Dušan Vlahović": { shirtNumber: 9, marketValue: 55, caps: 30, careerGoals: 100, trophies: [], preferredFoot: "Left" },
  "Federico Chiesa": { shirtNumber: 7, marketValue: 30, caps: 45, careerGoals: 40, trophies: ["Euros"], preferredFoot: "Right" },

  // === AC MILAN ===
  "Rafael Leão": { shirtNumber: 10, marketValue: 80, caps: 35, careerGoals: 55, trophies: ["Serie A"], preferredFoot: "Right" },
  "Theo Hernández": { shirtNumber: 19, marketValue: 50, caps: 35, careerGoals: 20, trophies: ["Serie A", "World Cup"], preferredFoot: "Left" },
  "Mike Maignan": { shirtNumber: 16, marketValue: 35, caps: 25, careerGoals: 0, trophies: ["Serie A", "Ligue 1"], preferredFoot: "Right" },

  // === INTER MILAN ===
  "Lautaro Martínez": { shirtNumber: 10, marketValue: 90, caps: 55, careerGoals: 130, trophies: ["Copa America", "Serie A", "World Cup"], preferredFoot: "Right" },
  "Nicolò Barella": { shirtNumber: 23, marketValue: 70, caps: 55, careerGoals: 25, trophies: ["Serie A", "Euros"], preferredFoot: "Right" },
  "Hakan Çalhanoğlu": { shirtNumber: 20, marketValue: 35, caps: 90, careerGoals: 40, trophies: ["Serie A"], preferredFoot: "Right" },

  // === NAPOLI ===
  "Victor Osimhen": { shirtNumber: 9, marketValue: 100, caps: 35, careerGoals: 85, trophies: ["Serie A"], preferredFoot: "Right" },
  "Khvicha Kvaratskhelia": { shirtNumber: 77, marketValue: 85, caps: 35, careerGoals: 25, trophies: ["Serie A"], preferredFoot: "Right" },
  "Giovanni Di Lorenzo": { shirtNumber: 22, marketValue: 25, caps: 40, careerGoals: 10, trophies: ["Serie A", "Euros"], preferredFoot: "Right" },

  // === ROMA ===
  "Paulo Dybala": { shirtNumber: 21, marketValue: 15, caps: 35, careerGoals: 140, trophies: ["World Cup", "Serie A (5)"], preferredFoot: "Left" },

  // === MARSEILLE / LYON / MONACO ===
  "Pierre-Emerick Aubameyang": { shirtNumber: 10, marketValue: 8, caps: 75, careerGoals: 260, trophies: ["DFB-Pokal"], preferredFoot: "Right" },

  // === SEVILLA ===
  "Youssef En-Nesyri": { shirtNumber: 15, marketValue: 25, caps: 70, careerGoals: 60, trophies: ["Europa League"], preferredFoot: "Right" },

  // === VILLARREAL ===
  "Gerard Moreno": { shirtNumber: 7, marketValue: 12, caps: 25, careerGoals: 130, trophies: ["Europa League"], preferredFoot: "Right" },
};

// ============================================================================
// TEAM CORRECTIONS
// Players known to be at wrong teams in TheSportsDB data
// ============================================================================
const TEAM_CORRECTIONS = {
  "Bruno Guimarães": { correctTeam: "Newcastle United", league: "Premier League" },
  "Erling Haaland": { correctTeam: "Manchester City", league: "Premier League" },
  "Bernardo Silva": { correctTeam: "Manchester City", league: "Premier League" },
  "Enzo Fernández": { correctTeam: "Chelsea", league: "Premier League" },
  "Gabriel Jesus": { correctTeam: "Arsenal", league: "Premier League" },
  "Christos Tzolis": null, // Remove - not a top-5 league player
  "Cristhian Mosquera": null, // Remove - not an Arsenal player
};

// ============================================================================
// MISSING STAR PLAYERS
// Key players that TheSportsDB didn't return in squad lookups
// ============================================================================
const MISSING_STAR_PLAYERS = [
  // Liverpool
  { name: "Mohamed Salah", nationality: "Egypt", position: "Forward", dateOfBirth: "1992-06-15", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Virgil van Dijk", nationality: "Netherlands", position: "Defender", dateOfBirth: "1991-07-08", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Trent Alexander-Arnold", nationality: "England", position: "Defender", dateOfBirth: "1998-10-07", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Alisson", nationality: "Brazil", position: "Goalkeeper", dateOfBirth: "1992-10-02", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Diogo Jota", nationality: "Portugal", position: "Forward", dateOfBirth: "1996-12-04", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Luis Díaz", nationality: "Colombia", position: "Forward", dateOfBirth: "1997-01-13", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2022,2023,2024,2025] }] },
  { name: "Darwin Núñez", nationality: "Uruguay", position: "Forward", dateOfBirth: "1999-06-24", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2022,2023,2024,2025] }] },
  { name: "Cody Gakpo", nationality: "Netherlands", position: "Forward", dateOfBirth: "1999-05-07", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Dominik Szoboszlai", nationality: "Hungary", position: "Midfielder", dateOfBirth: "2000-10-25", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Alexis Mac Allister", nationality: "Argentina", position: "Midfielder", dateOfBirth: "1998-12-24", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Andrew Robertson", nationality: "Scotland", position: "Defender", dateOfBirth: "1994-03-11", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Ryan Gravenberch", nationality: "Netherlands", position: "Midfielder", dateOfBirth: "2002-05-16", teams: [{ team: "Liverpool", league: "Premier League", seasons: [2023,2024,2025] }] },
  // Real Madrid
  { name: "Vinícius Júnior", nationality: "Brazil", position: "Forward", dateOfBirth: "2000-07-12", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Jude Bellingham", nationality: "England", position: "Midfielder", dateOfBirth: "2003-06-29", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2023,2024,2025] }, { team: "Borussia Dortmund", league: "Bundesliga", seasons: [2020,2021,2022,2023] }] },
  { name: "Kylian Mbappé", nationality: "France", position: "Forward", dateOfBirth: "1998-12-20", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2024,2025] }, { team: "Paris Saint-Germain", league: "Ligue 1", seasons: [2017,2018,2019,2020,2021,2022,2023,2024] }] },
  { name: "Toni Kroos", nationality: "Germany", position: "Midfielder", dateOfBirth: "1990-01-04", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024] }] },
  { name: "Luka Modrić", nationality: "Croatia", position: "Midfielder", dateOfBirth: "1985-09-09", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Federico Valverde", nationality: "Uruguay", position: "Midfielder", dateOfBirth: "1998-07-22", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Thibaut Courtois", nationality: "Belgium", position: "Goalkeeper", dateOfBirth: "1992-05-11", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Antonio Rüdiger", nationality: "Germany", position: "Defender", dateOfBirth: "1993-03-03", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2022,2023,2024,2025] }] },
  { name: "Dani Carvajal", nationality: "Spain", position: "Defender", dateOfBirth: "1992-01-11", teams: [{ team: "Real Madrid", league: "La Liga", seasons: [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  // Barcelona
  { name: "Robert Lewandowski", nationality: "Poland", position: "Forward", dateOfBirth: "1988-08-21", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2022,2023,2024,2025] }, { team: "Bayern Munich", league: "Bundesliga", seasons: [2014,2015,2016,2017,2018,2019,2020,2021,2022] }] },
  { name: "Pedri", nationality: "Spain", position: "Midfielder", dateOfBirth: "2002-11-25", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Gavi", nationality: "Spain", position: "Midfielder", dateOfBirth: "2004-08-05", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2021,2022,2023,2024,2025] }] },
  { name: "Lamine Yamal", nationality: "Spain", position: "Forward", dateOfBirth: "2007-07-13", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2023,2024,2025] }] },
  { name: "Raphinha", nationality: "Brazil", position: "Forward", dateOfBirth: "1996-12-14", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2022,2023,2024,2025] }] },
  { name: "Marc-André ter Stegen", nationality: "Germany", position: "Goalkeeper", dateOfBirth: "1992-04-30", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Jules Koundé", nationality: "France", position: "Defender", dateOfBirth: "1998-11-01", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2022,2023,2024,2025] }] },
  { name: "Ronald Araújo", nationality: "Uruguay", position: "Defender", dateOfBirth: "1999-03-07", teams: [{ team: "FC Barcelona", league: "La Liga", seasons: [2020,2021,2022,2023,2024,2025] }] },
  // Atletico Madrid
  { name: "Antoine Griezmann", nationality: "France", position: "Forward", dateOfBirth: "1991-03-21", teams: [{ team: "Atletico Madrid", league: "La Liga", seasons: [2014,2015,2016,2017,2018,2019,2021,2022,2023,2024,2025] }] },
  { name: "Jan Oblak", nationality: "Slovenia", position: "Goalkeeper", dateOfBirth: "1993-01-07", teams: [{ team: "Atletico Madrid", league: "La Liga", seasons: [2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Álvaro Morata", nationality: "Spain", position: "Forward", dateOfBirth: "1992-10-23", teams: [{ team: "Atletico Madrid", league: "La Liga", seasons: [2019,2020,2021,2022,2023,2024] }, { team: "AC Milan", league: "Serie A", seasons: [2024,2025] }] },
  // Man City
  { name: "Phil Foden", nationality: "England", position: "Forward", dateOfBirth: "2000-05-28", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Rodri", nationality: "Spain", position: "Midfielder", dateOfBirth: "1996-06-22", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Kevin De Bruyne", nationality: "Belgium", position: "Midfielder", dateOfBirth: "1991-06-28", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Jack Grealish", nationality: "England", position: "Forward", dateOfBirth: "1995-09-10", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2021,2022,2023,2024,2025] }] },
  { name: "Rúben Dias", nationality: "Portugal", position: "Defender", dateOfBirth: "1997-05-14", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Kyle Walker", nationality: "England", position: "Defender", dateOfBirth: "1990-05-28", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024] }] },
  { name: "Ederson", nationality: "Brazil", position: "Goalkeeper", dateOfBirth: "1993-08-17", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "John Stones", nationality: "England", position: "Defender", dateOfBirth: "1994-05-28", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Julián Álvarez", nationality: "Argentina", position: "Forward", dateOfBirth: "2000-01-31", teams: [{ team: "Atletico Madrid", league: "La Liga", seasons: [2024,2025] }, { team: "Manchester City", league: "Premier League", seasons: [2022,2023,2024] }] },
  { name: "Jeremy Doku", nationality: "Belgium", position: "Forward", dateOfBirth: "2002-05-27", teams: [{ team: "Manchester City", league: "Premier League", seasons: [2023,2024,2025] }] },
  // Man United
  { name: "Marcus Rashford", nationality: "England", position: "Forward", dateOfBirth: "1997-10-31", teams: [{ team: "Manchester United", league: "Premier League", seasons: [2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Bruno Fernandes", nationality: "Portugal", position: "Midfielder", dateOfBirth: "1994-09-08", teams: [{ team: "Manchester United", league: "Premier League", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Casemiro", nationality: "Brazil", position: "Midfielder", dateOfBirth: "1992-02-23", teams: [{ team: "Manchester United", league: "Premier League", seasons: [2022,2023,2024,2025] }, { team: "Real Madrid", league: "La Liga", seasons: [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022] }] },
  { name: "Kobbie Mainoo", nationality: "England", position: "Midfielder", dateOfBirth: "2005-04-19", teams: [{ team: "Manchester United", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Alejandro Garnacho", nationality: "Argentina", position: "Forward", dateOfBirth: "2004-07-01", teams: [{ team: "Manchester United", league: "Premier League", seasons: [2022,2023,2024,2025] }] },
  // Tottenham
  { name: "Heung-Min Son", nationality: "South Korea", position: "Forward", dateOfBirth: "1992-07-08", teams: [{ team: "Tottenham Hotspur", league: "Premier League", seasons: [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "James Maddison", nationality: "England", position: "Midfielder", dateOfBirth: "1996-11-23", teams: [{ team: "Tottenham Hotspur", league: "Premier League", seasons: [2023,2024,2025] }] },
  // Chelsea extras
  { name: "Reece James", nationality: "England", position: "Defender", dateOfBirth: "1999-12-08", teams: [{ team: "Chelsea", league: "Premier League", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Noni Madueke", nationality: "England", position: "Forward", dateOfBirth: "2002-03-10", teams: [{ team: "Chelsea", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Moisés Caicedo", nationality: "Ecuador", position: "Midfielder", dateOfBirth: "2001-11-02", teams: [{ team: "Chelsea", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Nicolas Jackson", nationality: "Senegal", position: "Forward", dateOfBirth: "2001-06-20", teams: [{ team: "Chelsea", league: "Premier League", seasons: [2023,2024,2025] }] },
  // Arsenal extras
  { name: "Martin Ødegaard", nationality: "Norway", position: "Midfielder", dateOfBirth: "1998-12-17", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2021,2022,2023,2024,2025] }] },
  { name: "William Saliba", nationality: "France", position: "Defender", dateOfBirth: "2001-03-24", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2022,2023,2024,2025] }] },
  { name: "Kai Havertz", nationality: "Germany", position: "Forward", dateOfBirth: "1999-06-11", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2023,2024,2025] }, { team: "Chelsea", league: "Premier League", seasons: [2021,2022,2023] }] },
  { name: "Gabriel Martinelli", nationality: "Brazil", position: "Forward", dateOfBirth: "2001-06-18", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Leandro Trossard", nationality: "Belgium", position: "Forward", dateOfBirth: "1994-12-04", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2023,2024,2025] }] },
  { name: "Jorginho", nationality: "Italy", position: "Midfielder", dateOfBirth: "1991-12-20", teams: [{ team: "Arsenal", league: "Premier League", seasons: [2023,2024,2025] }, { team: "Chelsea", league: "Premier League", seasons: [2019,2020,2021,2022,2023] }] },
  // Bayern Munich
  { name: "Harry Kane", nationality: "England", position: "Forward", dateOfBirth: "1993-07-28", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2023,2024,2025] }, { team: "Tottenham Hotspur", league: "Premier League", seasons: [2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023] }] },
  { name: "Jamal Musiala", nationality: "Germany", position: "Midfielder", dateOfBirth: "2003-02-26", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Joshua Kimmich", nationality: "Germany", position: "Midfielder", dateOfBirth: "1995-02-08", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Leroy Sané", nationality: "Germany", position: "Forward", dateOfBirth: "1996-01-11", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Thomas Müller", nationality: "Germany", position: "Forward", dateOfBirth: "1989-09-13", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Manuel Neuer", nationality: "Germany", position: "Goalkeeper", dateOfBirth: "1986-03-27", teams: [{ team: "Bayern Munich", league: "Bundesliga", seasons: [2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024] }] },
  // Dortmund
  { name: "Marco Reus", nationality: "Germany", position: "Forward", dateOfBirth: "1989-05-31", teams: [{ team: "Borussia Dortmund", league: "Bundesliga", seasons: [2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024] }] },
  { name: "Mats Hummels", nationality: "Germany", position: "Defender", dateOfBirth: "1988-12-16", teams: [{ team: "Borussia Dortmund", league: "Bundesliga", seasons: [2009,2010,2011,2012,2013,2014,2015,2016,2019,2020,2021,2022,2023,2024] }, { team: "Roma", league: "Serie A", seasons: [2024,2025] }] },
  // Leverkusen
  { name: "Florian Wirtz", nationality: "Germany", position: "Midfielder", dateOfBirth: "2003-05-03", teams: [{ team: "Bayer Leverkusen", league: "Bundesliga", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Granit Xhaka", nationality: "Switzerland", position: "Midfielder", dateOfBirth: "1992-09-27", teams: [{ team: "Bayer Leverkusen", league: "Bundesliga", seasons: [2023,2024,2025] }, { team: "Arsenal", league: "Premier League", seasons: [2016,2017,2018,2019,2020,2021,2022,2023] }] },
  // PSG
  { name: "Ousmane Dembélé", nationality: "France", position: "Forward", dateOfBirth: "1997-05-15", teams: [{ team: "Paris Saint-Germain", league: "Ligue 1", seasons: [2023,2024,2025] }, { team: "FC Barcelona", league: "La Liga", seasons: [2017,2018,2019,2020,2021,2022,2023] }] },
  { name: "Marquinhos", nationality: "Brazil", position: "Defender", dateOfBirth: "1994-05-14", teams: [{ team: "Paris Saint-Germain", league: "Ligue 1", seasons: [2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Achraf Hakimi", nationality: "Morocco", position: "Defender", dateOfBirth: "1998-11-04", teams: [{ team: "Paris Saint-Germain", league: "Ligue 1", seasons: [2021,2022,2023,2024,2025] }] },
  // Inter Milan
  { name: "Lautaro Martínez", nationality: "Argentina", position: "Forward", dateOfBirth: "1997-08-22", teams: [{ team: "Inter Milan", league: "Serie A", seasons: [2018,2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Nicolò Barella", nationality: "Italy", position: "Midfielder", dateOfBirth: "1997-02-07", teams: [{ team: "Inter Milan", league: "Serie A", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  // AC Milan
  { name: "Rafael Leão", nationality: "Portugal", position: "Forward", dateOfBirth: "1999-06-10", teams: [{ team: "AC Milan", league: "Serie A", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  { name: "Theo Hernández", nationality: "France", position: "Defender", dateOfBirth: "1997-10-06", teams: [{ team: "AC Milan", league: "Serie A", seasons: [2019,2020,2021,2022,2023,2024,2025] }] },
  // Napoli
  { name: "Victor Osimhen", nationality: "Nigeria", position: "Forward", dateOfBirth: "1998-12-29", teams: [{ team: "Napoli", league: "Serie A", seasons: [2020,2021,2022,2023,2024,2025] }] },
  { name: "Khvicha Kvaratskhelia", nationality: "Georgia", position: "Forward", dateOfBirth: "2001-02-12", teams: [{ team: "Napoli", league: "Serie A", seasons: [2022,2023,2024,2025] }] },
  // Juventus
  { name: "Dušan Vlahović", nationality: "Serbia", position: "Forward", dateOfBirth: "2000-01-28", teams: [{ team: "Juventus", league: "Serie A", seasons: [2022,2023,2024,2025] }] },
  // Roma
  { name: "Paulo Dybala", nationality: "Argentina", position: "Forward", dateOfBirth: "1993-11-15", teams: [{ team: "Roma", league: "Serie A", seasons: [2022,2023,2024,2025] }, { team: "Juventus", league: "Serie A", seasons: [2015,2016,2017,2018,2019,2020,2021,2022] }] },
  // Newcastle
  { name: "Alexander Isak", nationality: "Sweden", position: "Forward", dateOfBirth: "1999-09-21", teams: [{ team: "Newcastle United", league: "Premier League", seasons: [2022,2023,2024,2025] }] },
  // Aston Villa
  { name: "Ollie Watkins", nationality: "England", position: "Forward", dateOfBirth: "1995-12-30", teams: [{ team: "Aston Villa", league: "Premier League", seasons: [2020,2021,2022,2023,2024,2025] }] },
];

// ============================================================================
// POSITION-BASED STAT ESTIMATES
// For players not in the curated database
// ============================================================================
const STAT_ESTIMATES = {
  "Goalkeeper": { marketValue: [5, 25], caps: [0, 30], careerGoals: [0, 0], shirtNumber: [1, 13], preferredFoot: "Right" },
  "Defender": { marketValue: [5, 40], caps: [0, 40], careerGoals: [2, 15], shirtNumber: [2, 6], preferredFoot: "Right" },
  "Midfielder": { marketValue: [10, 50], caps: [0, 45], careerGoals: [5, 35], shirtNumber: [6, 14], preferredFoot: "Right" },
  "Forward": { marketValue: [10, 60], caps: [0, 35], careerGoals: [15, 65], shirtNumber: [7, 11], preferredFoot: "Right" },
};

// Seeded random for reproducible results
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function randomInRange(rng, min, max) {
  return Math.round(min + rng() * (max - min));
}

// ============================================================================
// MAIN ENRICHMENT PIPELINE
// ============================================================================
function enrichPlayers() {
  console.log("🚀 Starting player data enrichment...\n");

  // Load existing data
  const rawPlayers = JSON.parse(fs.readFileSync(PLAYERS_JSON, 'utf8'));
  const goldStandard = JSON.parse(fs.readFileSync(GOLD_STANDARD_JSON, 'utf8'));

  console.log(`📦 Loaded ${rawPlayers.length} players from players.json`);
  console.log(`⭐ Loaded ${goldStandard.length} gold standard players\n`);

  const enrichedPlayers = [];
  const playerNames = new Set();
  let curatedCount = 0;
  let estimatedCount = 0;
  let removedCount = 0;
  let deduplicatedCount = 0;

  for (const player of rawPlayers) {
    // Check if player should be removed
    if (TEAM_CORRECTIONS[player.name] === null) {
      removedCount++;
      continue;
    }

    // Skip duplicate player names
    if (playerNames.has(player.name)) continue;
    playerNames.add(player.name);

    // Deduplicate team entries
    const uniqueTeams = [];
    const seenTeams = new Set();
    for (const teamEntry of (player.teams || [])) {
      const key = `${teamEntry.team}|${teamEntry.league}`;
      if (!seenTeams.has(key)) {
        seenTeams.add(key);
        uniqueTeams.push(teamEntry);
      } else {
        deduplicatedCount++;
      }
    }
    player.teams = uniqueTeams;

    // Apply team corrections
    if (TEAM_CORRECTIONS[player.name]) {
      const correction = TEAM_CORRECTIONS[player.name];
      player.teams = [{
        team: correction.correctTeam,
        league: correction.league,
        seasons: player.teams[0]?.seasons || [2022, 2023, 2024, 2025]
      }];
    }

    // Enrich with curated stats
    const curated = CURATED_STATS[player.name];
    if (curated) {
      player.shirtNumber = curated.shirtNumber;
      player.marketValue = curated.marketValue;
      player.caps = curated.caps;
      player.careerGoals = curated.careerGoals;
      player.trophies = curated.trophies;
      player.preferredFoot = curated.preferredFoot;

      // Apply team correction from curated data
      if (curated.correctTeam) {
        player.teams = [{
          team: curated.correctTeam,
          league: player.teams[0]?.league || "Premier League",
          seasons: player.teams[0]?.seasons || [2022, 2023, 2024, 2025]
        }];
      }

      curatedCount++;
    } else {
      // Estimate stats based on position
      const estimates = STAT_ESTIMATES[player.position] || STAT_ESTIMATES["Midfielder"];
      const rng = seededRandom(player.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0));

      player.shirtNumber = player.shirtNumber || randomInRange(rng, estimates.shirtNumber[0], estimates.shirtNumber[1]);
      player.marketValue = player.marketValue || randomInRange(rng, estimates.marketValue[0], estimates.marketValue[1]);
      player.caps = player.caps || randomInRange(rng, estimates.caps[0], estimates.caps[1]);
      player.careerGoals = player.careerGoals || randomInRange(rng, estimates.careerGoals[0], estimates.careerGoals[1]);
      player.trophies = player.trophies || [];
      player.preferredFoot = player.preferredFoot || (rng() > 0.8 ? "Left" : "Right");

      estimatedCount++;
    }

    enrichedPlayers.push(player);
  }

  // Inject missing star players
  let injectedCount = 0;
  for (const starPlayer of MISSING_STAR_PLAYERS) {
    if (!playerNames.has(starPlayer.name)) {
      const curated = CURATED_STATS[starPlayer.name];
      if (curated) {
        starPlayer.shirtNumber = curated.shirtNumber;
        starPlayer.marketValue = curated.marketValue;
        starPlayer.caps = curated.caps;
        starPlayer.careerGoals = curated.careerGoals;
        starPlayer.trophies = curated.trophies;
        starPlayer.preferredFoot = curated.preferredFoot;
        curatedCount++;
      } else {
        const estimates = STAT_ESTIMATES[starPlayer.position] || STAT_ESTIMATES["Midfielder"];
        const rng = seededRandom(starPlayer.name.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
        starPlayer.shirtNumber = randomInRange(rng, estimates.shirtNumber[0], estimates.shirtNumber[1]);
        starPlayer.marketValue = randomInRange(rng, estimates.marketValue[0], estimates.marketValue[1]);
        starPlayer.caps = randomInRange(rng, estimates.caps[0], estimates.caps[1]);
        starPlayer.careerGoals = randomInRange(rng, estimates.careerGoals[0], estimates.careerGoals[1]);
        starPlayer.trophies = [];
        starPlayer.preferredFoot = rng() > 0.8 ? "Left" : "Right";
        estimatedCount++;
      }
      starPlayer.id = `star_${injectedCount + 1}`;
      enrichedPlayers.push(starPlayer);
      playerNames.add(starPlayer.name);
      injectedCount++;
    }
  }

  // Integrate gold standard players
  let goldIntegrated = 0;
  for (const gp of goldStandard) {
    if (!playerNames.has(gp.name)) {
      enrichedPlayers.push(gp);
      playerNames.add(gp.name);
      goldIntegrated++;
    } else {
      // Override existing player with gold standard data
      const idx = enrichedPlayers.findIndex(p => p.name === gp.name);
      if (idx >= 0) {
        enrichedPlayers[idx] = { ...enrichedPlayers[idx], ...gp, id: enrichedPlayers[idx].id };
      }
    }
  }

  // Write enriched data
  fs.writeFileSync(PLAYERS_JSON, JSON.stringify(enrichedPlayers, null, 2));

  console.log("✅ Enrichment complete!\n");
  console.log(`   📊 Curated stats applied: ${curatedCount} players`);
  console.log(`   📈 Estimated stats applied: ${estimatedCount} players`);
  console.log(`   ⭐ Gold standard integrated: ${goldIntegrated} players`);
  console.log(`   🔄 Duplicate team entries removed: ${deduplicatedCount}`);
  console.log(`   🗑️  Invalid players removed: ${removedCount}`);
  console.log(`   🌟 Missing star players injected: ${injectedCount}`);
  console.log(`   📝 Total players in output: ${enrichedPlayers.length}\n`);

  // Validation
  let missingStats = 0;
  for (const p of enrichedPlayers) {
    if (!p.marketValue && p.marketValue !== 0) missingStats++;
    if (!p.caps && p.caps !== 0) missingStats++;
    if (!p.careerGoals && p.careerGoals !== 0) missingStats++;
    if (!p.preferredFoot) missingStats++;
    if (!p.shirtNumber && p.shirtNumber !== 0) missingStats++;
  }

  if (missingStats > 0) {
    console.warn(`⚠️  Warning: ${missingStats} missing stat field(s) remain.`);
  } else {
    console.log("✅ All players have complete stats!");
  }

  return enrichedPlayers.length;
}

enrichPlayers();
