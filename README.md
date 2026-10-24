# CS2 Nade Book

A personal grenade lineup book for Counter-Strike 2. It runs entirely in the browser, with no server and no install.

**Open it:** https://xxld.github.io/cs2-nade-book/ (or download the folder and double-click `start.bat` / `index.html`).

## What it does
- Radar map for every active-duty map (Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke) with all lineups on it.
- Each lineup has its exact stand spot, a `setpos`/`setang` line to paste into a practice server, throw type, movement, and aim screenshots with the crosshair marked.
- You decide what stays: keep or discard any lineup, review them one by one (K / D / S / U), filter by source and age.
- Setups (chains of nades for an execute) and a practice mode that tracks your hit rate.
- Add your own nades, set landing spots by hand, export / import everything as JSON.

Your own data (decisions, practice history, your nades) is saved in your browser only. Use **Export** to back it up.

## Data sources and credits
- Lineups: [cs2util.com](https://www.cs2util.com) and [csnades.gg](https://csnades.gg) (lineup positions, `setpos` values and screenshots belong to their authors).
- Radar images and calibration: [MurkyYT/cs2-map-icons](https://github.com/MurkyYT/cs2-map-icons) (extracted from the game files; Valve's artwork).
- Counter-Strike 2 and its maps are property of Valve.

Stand spots are exact (computed from each `setpos`). Landing spots are estimates from the lineup name and aim direction, so check them in game. Lineups change with game updates: verify before you rely on one.

## Takedown
This is a non-commercial personal project. If you own any of the screenshots or data here and want them removed, open an issue and they will be taken down.
