# Puzzles

Auto-generated puzzle games. Every board has exactly one solution, and its
difficulty is measured rather than guessed.

Independent implementations of puzzle ideas popularised by LinkedIn's daily
games. Not affiliated with, endorsed by, or connected to LinkedIn; no code or
assets are taken from anywhere. MIT licensed — see `LICENSE`.

```
npm install
npm run dev            # play locally
npm run build          # typecheck, then bundle to dist/
./test/all.sh          # everything
```

## The games

**Zip** — draw a single line that visits every square exactly once, starting at
1 and taking the numbers in order without crossing a wall.

**Queens** — place one queen in every row, every column and every colour
region, with no two queens touching, not even diagonally.

Both have a daily board shared by everyone, four practice sizes, hints,
streaks, and results you can share.

## Generation

Both generators work backwards from a guaranteed-valid solution, then add
constraints until it is the *only* solution — because for both games, random
constraints essentially never produce a unique board:

| | random attempts | uniquely solvable |
|---|---|---|
| Zip, numbers only, no walls | 120 grids at 7×7 | **0** |
| Queens, random regions | 400 carvings per size | **0** |

So each refines against its own rival solutions. A rival must differ from the
intended solution somewhere, and that difference is what gets attacked:

- **Zip** — a rival path must use an edge the intended path does not. Wall that
  edge and the rival dies; the intended path cannot be touched, because none of
  its own edges is ever walled.
- **Queens** — a rival must place a queen where the intended solution does not.
  Move that square into a region the rival already uses elsewhere and it now
  needs two queens in one region, which is illegal. The intended solution is
  untouched because a queen's own square is never the one that moves.

Both reach 100% yield with this, at every size.

## Difficulty is measured

A solver applies only the deductions a person actually has — forced moves,
connectivity and parity for Zip; row, column and region elimination for Queens —
and counts the positions where it is still genuinely left with a choice. Tiers
are bands on that count, so "Hard" means the same amount of thinking in both
games. Puzzles outside the band are rejected.

## Architecture

```
src/shell/       routing, registry, daily/streaks/history/share, prefs, audio, fx
  core.ts        ShellCore: timing, the reveal gate, saved runs, snapshots
src/games/zip/   engine, board renderer, rules
src/games/queens/
src/components/  React chrome, shared by every game
```

`ShellCore` owns everything that is not a rule, which is where the promises
live: the clock belongs to the puzzle rather than the attempt, a refresh cannot
hand you a fresh board, the first solve of a day is the one that counts, a
superseded generation never lands, and a tab left open across midnight picks up
the new day. Those were written twice before this existed — two copies that
could drift apart.

A game supplies its engine, its board, and answers to
`resetState / applyPuzzle / redraw / progress / encodeMoves / decodeMoves /
celebrationCell / attachInput`, plus optional hooks for undo, hint, reveal,
per-frame work and extra keys.

Boards are drawn **imperatively**. Drawing runs on every pointer move and every
animation frame — a finished board plus a celebration is several hundred
attribute writes per frame — which is a mutation workload, not a reconciliation
one. React owns the chrome and hands each game its `<svg>` by ref. The core
publishes a snapshot to React at most once per animation frame, so however fast
the pointer moves, the chrome re-renders at a human rate.

## Tests

```
test/verify.js     Zip generation: legality, uniqueness, difficulty band
test/play.js       Zip interaction rules
test/queens.js     Queens generation: placements, regions, uniqueness, band
test/daily.js      date rollover, seeding, storage versioning, streaks
test/changelog.js  release data, and CHANGELOG.md in step with it
test/render.js     the built app in real Chrome, driven by real input
test/browser.js    a small dependency-free CDP driver
```

The browser suite drives `dist-test`, which differs from the deployed `dist`
only by the `?test` hook flag; `dist` is built too and asserted to contain no
hook at all — it exposes the solution, which is fine on a random practice board
and not on a shared daily.

## Deploying

`.github/workflows/deploy.yml` runs everything on each push to `main` and
publishes `dist/` to GitHub Pages only if it passes. Set **Settings → Pages →
Source** to **GitHub Actions** once.
