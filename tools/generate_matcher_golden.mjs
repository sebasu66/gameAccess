import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { cleanTitle, calculateScore } = require("C:/DEV/ga-torrent-plugin/matcher.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../apps/desktop/src-tauri/src/matcher_golden.json");

const handCraftedPairs = [
  // Exact matches & normalization
  ["Elden Ring", "Elden Ring"],
  ["Elden Ring", "ELDEN RING"],
  ["Elden Ring", "Elden Ring: Deluxe Edition [Repack]"],
  ["The Witcher 3 - Wild Hunt", "The Witcher 3: Wild Hunt - Complete Edition (v4.04) [FitGirl Repack]"],
  ["Half-Life 2©", "Half-Life 2"],
  ["Half-Life 2", "Half-Life 2®™©℠"],
  ["", "Elden Ring"],
  ["Elden Ring", ""],
  ["   ", "Elden Ring"],

  // CamelCase split=true vs split=false
  ["Dead Space", "DeadSpace"],
  ["DeadSpace", "Dead Space"],
  ["Dead Space", "DeadSpace Remake Deluxe Edition"],
  ["Dead Space", "DeadSpace 2"],
  ["Gunman", "GunMan"],
  ["GunMan", "Gunman"],
  ["Gunman", "GunMan v1.04 [DODI Repack]"],
  ["GunMan Chronicles", "Gunman Chronicles v1.1"],
  ["Gunman Chronicles", "GunMan Chronicles (2000) [Repack]"],
  ["McPixel", "McPixel"],
  ["McPixel", "McPixel 3"],
  ["McPixel 3", "McPixel 3 v1.0.5"],
  ["BioShock", "Bioshock"],
  ["BioShock", "BioShock Remastered v1.0"],
  ["BioShock", "BioShock Infinite"],
  ["BioShock Infinite", "BioshockInfinite Complete Edition"],
  ["OutRun 2006", "OutRun2006 Coast 2 Coast"],
  ["StarCraft", "Starcraft Remastered v1.23"],
  ["MegaMan Battle Network", "Mega Man Battle Network Legacy Collection"],
  ["Mega Man", "MegaMan v2.1"],
  ["CyberPunk 2077", "Cyberpunk 2077 Ultimate Edition (v2.12)"],

  // Repacker prefixes (fitgirl, dodi, repack, repacks, onlinefix)
  ["Elden Ring", "FitGirl Elden Ring"],
  ["Elden Ring", "DODI Repacks Elden Ring"],
  ["Elden Ring", "OnlineFix FitGirl Repack Elden Ring"],
  ["Elden Ring", "[FitGirl Repack] Elden Ring"],
  ["Elden Ring", "FitGirl Dodi Repack Repacks Onlinefix Elden Ring v1.12"],
  ["Elden Ring", "FitGirl Dodi Repack Repacks Onlinefix Elden Ring Sequel"],
  ["Repack Simulator", "Repack Simulator"],
  ["Repack Simulator", "FitGirl Repack Repack Simulator v1.0"],
  ["OnlineFix", "OnlineFix"],

  // Dotted versions (with and without dots in rawTitle, word boundaries)
  ["Elden Ring", "Elden Ring 1.12"],
  ["Elden Ring", "Elden Ring 1.12.3"],
  ["Elden Ring", "Elden Ring 1 12"],
  ["Elden Ring", "Elden Ring (1.12) 2"],
  ["Elden Ring", "Elden Ring (1.12) 2 3"],
  ["Elden Ring", "Elden Ring v1.12"],
  ["Elden Ring", "Elden Ring a1.12 1 12"],
  ["Elden Ring", "Elden Ring [v1.0] 1 0"],
  ["Elden Ring", "Elden Ring _1.2 1 2"],
  ["Elden Ring", "Elden Ring -1.2 1 2"],
  ["Factorio", "Factorio 2.0.7"],
  ["Factorio", "Factorio 2 0 7"],
  ["Terraria", "Terraria 1.4.4.9 Multi10"],
  ["Stardew Valley", "Stardew Valley 1.6.8 (Build 24119)"],

  // Release keywords & "starts with" edge cases ("allstars", "without", "winter", etc.)
  ["Sonic", "Sonic Allstars Racing"],
  ["Sonic", "Sonic All-Stars Racing Transformed"],
  ["Sonic", "Sonic All DLC Edition"],
  ["Sonic", "Sonic With Knuckles"],
  ["Sonic", "Sonic Without Tails"],
  ["Sonic", "Sonic Win10 Edition"],
  ["Sonic", "Sonic Winter Adventures"],
  ["Sonic", "Sonic Windows Edition"],
  ["Sonic", "Sonic Version 2.0"],
  ["Sonic", "Sonic Ver 1.5"],
  ["Sonic", "Sonic Verdict"],
  ["Sonic", "Sonic Build 12345"],
  ["Sonic", "Sonic Builder"],
  ["Sonic", "Sonic Free Download"],
  ["Sonic", "Sonic Freedom"],
  ["Sonic", "Sonic Downloadable Content"],
  ["Sonic", "Sonic Multi5"],
  ["Sonic", "Sonic Multi"],
  ["Sonic", "Sonic Multiplayer"],
  ["Sonic", "Sonic Update 5"],
  ["Sonic", "Sonic Updated"],
  ["Sonic", "Sonic DLC Pack"],
  ["Sonic", "Sonic Deluxe"],
  ["Sonic", "Sonic Ultimate"],
  ["Sonic", "Sonic Complete"],
  ["Sonic", "Sonic Edition"],
  ["Sonic", "Sonic GOTY"],
  ["Sonic", "Sonic OnlineFix"],
  ["Sonic", "Sonic FitGirl"],
  ["Sonic", "Sonic DODI"],
  ["Sonic", "Sonic SteamRIP"],
  ["Sonic", "Sonic GOG"],
  ["Sonic", "Sonic Incl DLC"],
  ["Sonic", "Sonic Including Soundtrack"],
  ["Sonic", "Sonic v1"],
  ["Sonic", "Sonic v"],
  ["Sonic", "Sonic vX"],
  ["Sonic", "Sonic 2"],
  ["Sonic", "Sonic Generations"],

  // Accents, diacritics, NFKD decomposition
  ["Pokémon Legends: Arceus", "Pokemon Legends Arceus v1.1.1"],
  ["Pokemon Legends Arceus", "Pokémon Legends: Arceus [FitGirl Repack]"],
  ["Café International", "Cafe International Deluxe"],
  ["God of War Ragnarök", "God of War Ragnarok v1.0.4 [DODI Repack]"],
  ["Brütal Legend", "Brutal Legend Complete Edition"],
  ["Ni no Kuni™: Wrath of the White Witch™ Remastered", "Ni no Kuni Wrath of the White Witch Remastered v1.02"],
  ["Sid Meier’s Civilization® VI", "Sid Meiers Civilization VI Anthology Edition"],
  ["Sid Meier's Civilization VI", "Sid Meier’s Civilization® VI [FitGirl Repack]"],
  ["Assassin's Creed Unity", "Assassins Creed Unity v1.5.0"],
  ["Baldur’s Gate 3", "Baldurs Gate 3 Digital Deluxe Edition (v4.1.1)"],
  [" Tom Clancy's Rainbow Six® Siege ", "Tom Clancys Rainbow Six Siege Deluxe"],
  ["Été", "Ete v1.0"],
  ["Ñandú", "Nandu Build 100"],
  ["Übersoldier", "Ubersoldier GOTY"],
  ["Ångström", "Angstrom 1.0"],

  // Ampersands (& -> " and ")
  ["Dungeons & Dragons: Dark Alliance", "Dungeons and Dragons Dark Alliance Deluxe"],
  ["Dungeons and Dragons: Dark Alliance", "Dungeons & Dragons Dark Alliance v1.20"],
  ["Command & Conquer™ Remastered Collection", "Command and Conquer Remastered Collection [FitGirl]"],
  ["Ratchet & Clank: Rift Apart", "Ratchet and Clank Rift Apart v1.831.0.0"],
  ["Mount & Blade II: Bannerlord", "Mount and Blade II Bannerlord v1.2.9"],
  ["Sam & Max Save the World", "Sam&Max Save the World Remastered"],
  ["A&B", "A and B"],
  ["A & B & C", "A and B and C v2"],

  // Parentheses and brackets (nested, unclosed, mixed)
  ["Resident Evil 4", "Resident Evil 4 (2023) [Deluxe Edition]"],
  ["Resident Evil 4 (2005)", "Resident Evil 4 Ultimate HD Edition"],
  ["Prey (2017)", "Prey [DODI Repack] v1.10"],
  ["DOOM (2016)", "DOOM v6.66 [FitGirl Repack]"],
  ["Game Title", "Game Title (Unclosed Paren v1.0"],
  ["Game Title", "Game Title [Unclosed Bracket v1.0"],
  ["Game Title", "Game Title (Paren [With Bracket) Inside] v1.0"],
  ["Game Title", "Game Title [Bracket (With Paren] Inside) v1.0"],
  ["Game Title", "Game (Ignored) Title [Ignored] v2.0"],
  ["(Leading Paren) Game", "Game (Trailing Paren) Deluxe"],
];

const baseGames = [
  "Hollow Knight",
  "Hollow Knight: Silksong",
  "Dark Souls",
  "Dark Souls II",
  "Dark Souls III",
  "Dark Souls: Remastered",
  "Sekiro™: Shadows Die Twice - GOTY Edition",
  "Bloodborne",
  "Armored Core™ VI: Fires of Rubicon™",
  "Monster Hunter: World",
  "Monster Hunter Rise",
  "Resident Evil 2",
  "Resident Evil 3",
  "Resident Evil 7 Biohazard",
  "Resident Evil Village",
  "Devil May Cry 5",
  "Street Fighter™ 6",
  "Dragon's Dogma 2",
  "Grand Theft Auto V",
  "Grand Theft Auto: San Andreas",
  "Red Dead Redemption 2",
  "Max Payne 3",
  "L.A. Noire",
  "Bully: Scholarship Edition",
  "The Elder Scrolls V: Skyrim Special Edition",
  "The Elder Scrolls IV: Oblivion® Game of the Year Edition",
  "Fallout 4",
  "Fallout: New Vegas",
  "Starfield",
  "DOOM Eternal",
  "Wolfenstein II: The New Colossus",
  "Dishonored 2",
  "Deathloop",
  "Hi-Fi RUSH",
  "Ghostwire: Tokyo",
  "Horizon Zero Dawn™ Complete Edition",
  "Horizon Forbidden West™ Complete Edition",
  "Marvel’s Spider-Man Remastered",
  "Marvel's Spider-Man: Miles Morales",
  "Days Gone",
  "Returnal™",
  "The Last of Us™ Part I",
  "UNCHARTED™: Legacy of Thieves Collection",
  "Ghost of Tsushima DIRECTOR'S CUT",
  "HELLDIVERS™ 2",
  "Hades",
  "Hades II",
  "Celeste",
  "Dead Cells",
  "Slay the Spire",
  "Balatro",
  "Vampire Survivors",
  "Brotato",
  "Cuphead",
  "Ori and the Blind Forest",
  "Ori and the Will of the Wisps",
  "Subnautica",
  "Subnautica: Below Zero",
  "No Man's Sky",
  "Valheim",
  "Palworld",
  "Enshrouded",
  "Sons Of The Forest",
  "The Forest",
  "Rust",
  "ARK: Survival Evolved",
  "ARK: Survival Ascended",
  "Conan Exiles",
  "Terraria",
  "Core Keeper",
  "RimWorld",
  "Dwarf Fortress",
  "Factorio",
  "Satisfactory",
  "Dyson Sphere Program",
  "Cities: Skylines",
  "Cities: Skylines II",
  "Planet Coaster",
  "Planet Zoo",
  "Two Point Hospital",
  "Two Point Campus",
  "Crusader Kings III",
  "Europa Universalis IV",
  "Hearts of Iron IV",
  "Stellaris",
  "Victoria 3",
  "Age of Empires II: Definitive Edition",
  "Age of Empires IV: Anniversary Edition",
  "Age of Mythology: Retold",
  "Total War: WARHAMMER III",
  "Total War: THREE KINGDOMS",
  "Persona 5 Royal",
  "Persona 3 Reload",
  "Metaphor: ReFantazio",
  "Like a Dragon: Infinite Wealth",
  "Yakuza 0",
  "NieR:Automata™",
  "NieR Replicant™ ver.1.22474487139...",
  "FINAL FANTASY VII REMAKE INTERGRADE",
  "FINAL FANTASY XVI",
  "CHRONO TRIGGER®",
  "DRAGON QUEST® XI S: Echoes of an Elusive Age™ - Definitive Edition",
  "Octopath Traveler II",
  "Kingdom Hearts HD 1.5+2.5 ReMIX",
];

const releaseTemplates = [
  name => name,
  name => `${name} [FitGirl Repack]`,
  name => `FitGirl Repack - ${name} (v1.04.2 + All DLCs, MULTi12)`,
  name => `DODI Repacks ${name} Deluxe EditionBuild 10293`,
  name => `OnlineFix ${name} v2.1.0 Incl Online Multiplayer`,
  name => `${name} 1.08.3 GOG`,
  name => `${name} 1 08 3`,
  name => `${name} Allstars Pack`,
  name => `${name} With Bonus Content`,
  name => `${name} Win64 SteamRIP`,
  name => `${name} 2: Electric Boogaloo`,
  name => `${name} Remake`,
  name => `${name.replace(/\s+/g, "")} v1.2`,
  name => `${name.replace(/and/gi, "&")} Complete Edition`,
];

const seen = new Set();
const pairs = [];

function addPair(gameName, rawTitle) {
  const key = `${gameName}\u0000${rawTitle}`;
  if (seen.has(key)) return;
  seen.add(key);
  pairs.push({
    game_name: gameName,
    raw_title: rawTitle,
    clean_game_split: cleanTitle(gameName, true),
    clean_game_nosplit: cleanTitle(gameName, false),
    clean_title_split: cleanTitle(rawTitle, true),
    clean_title_nosplit: cleanTitle(rawTitle, false),
    score: calculateScore(gameName, rawTitle),
  });
}

for (const [g, t] of handCraftedPairs) {
  addPair(g, t);
}

let tIdx = 0;
outer: for (const game of baseGames) {
  for (let k = 0; k < 4; k++) {
    const template = releaseTemplates[(tIdx + k) % releaseTemplates.length];
    addPair(game, template(game));
    if (pairs.length >= 520) break outer;
  }
  // Cross-game negative check (sequel / neighbor game)
  const other = baseGames[(tIdx + 1) % baseGames.length];
  addPair(game, `${other} v1.0 [FitGirl Repack]`);
  if (pairs.length >= 520) break outer;
  tIdx++;
}

writeFileSync(outPath, JSON.stringify(pairs, null, 2) + "\n", "utf8");
console.log(`Generated ${pairs.length} golden pairs at ${outPath}`);
