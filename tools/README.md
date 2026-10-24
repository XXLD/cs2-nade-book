# Updating the lineups

`update_lineups.py` keeps the starter data (`seed-dust2.js`, `seed-maps.js`, screenshots in `shots/`) up to date from
[csnades.gg](https://csnades.gg) and [cs2util.com](https://www.cs2util.com). It works **in place**: it reads the lineups you already
have, finds new ones, adds them and never deletes anything. Needs Python 3 and Pillow (`pip install pillow`).

```
python tools/update_lineups.py                # dry run: what is new / really changed
python tools/update_lineups.py --apply        # download screenshots, write the seed files
python tools/update_lineups.py --check 6      # self-test against 6 known lineups per source
python tools/update_lineups.py --apply --source cs2util --maps cache --months 6
```

After `--apply`, open the app and press Ctrl+F5. The seed version was raised automatically, so the app loads the new lineups
by itself. They appear as "to review"; your keep/discard decisions, tested flags and fixed landing spots are never overwritten.

## Rules it follows
- Only active-duty maps (`ACTIVE` at the top of the script) and only lineups updated within `--months` (default 12).
- **A newer date alone is not a change.** Both sites touch many pages at once (cs2util stamped 92 Dust II pages on one day).
  A lineup counts as changed only if its `setpos` or technique differs; date-only touches are ignored and reported.
- Stand spots are exact (computed from the `setpos` and the radar calibration in `CAL`). Landing spots are matched by name against
  lineups you already have, then moved onto the lineup's aim line; if nothing matches, the lineup is tagged `landing-approx`.
- csnades "community" pages (video only) and cs2util anonymous user uploads are skipped: they have no `setpos` or screenshot.

## Data format (one lineup)
`id, map, name, type, variant, side, purpose, technique, status, from {x,y}, to {x,y}, setpos, video (source page), notes, tags,
images [{src,label}], updated, source`. Coordinates are on a 1000x1000 grid over the radar image. In the browser a lineup also
gets your own fields: `decision` (keep/discard), `tested` + `testedAt`, `landingFixed`, `log`.

## If the update misbehaves
Run `--check 10`. If lineups differ from the seed data, a site changed its page layout and the parsing in `build_csn` /
`build_cu` needs adjusting. The old multi-script pipeline (temporary files) is gone; this one script replaces it.
