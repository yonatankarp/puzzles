/*
 * The pictures in "how to play" have to obey the rules they are teaching.
 * Checked with the games' own engines, not by eye.
 */
import { makeEngine } from '../src/games/zip/engine.ts';
import { solveAll, analyze, cellsOf } from '../src/games/patch/engine.ts';
import { solveAll as lampSolve, analyze as lampAnalyze, beamOf, WALL as LAMP_WALL } from '../src/games/lamplight/engine.ts';
import { findSolutions } from '../src/games/queens/engine.ts';
import { ZIP_DIAGRAM, QUEENS_DIAGRAM, PATCH_DIAGRAM, LAMPLIGHT_DIAGRAM } from '../src/components/diagrams.ts';

let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

// --- Zip -----------------------------------------------------------------------
{
  const d = ZIP_DIAGRAM;
  const engine = makeEngine(d);
  ok(engine.validate(d.solution), 'the Zip diagram breaks its own rules');
  ok(d.solution.length === d.rows * d.cols, 'the Zip diagram does not fill the board');
  ok(new Set(d.solution).size === d.solution.length, 'the Zip diagram visits a square twice');

  // The wall has to be somewhere the line does not go, or the picture teaches
  // the opposite of the rule it is next to.
  const used = new Set();
  for (let i = 0; i + 1 < d.solution.length; i++) {
    const a = d.solution[i], b = d.solution[i + 1];
    used.add(`${Math.min(a, b)},${Math.max(a, b)}`);
  }
  for (const [a, b] of d.walls) {
    ok(!used.has(`${a},${b}`), `the illustrated line crosses the wall between ${a} and ${b}`);
    const gap = Math.abs(a - b);
    ok(gap === 1 || gap === d.cols, `the wall ${a}-${b} is not between adjacent squares`);
  }
  ok(d.walls.length > 0, 'the Zip diagram shows no wall, so it cannot illustrate the rule');
}

// --- Queens ---------------------------------------------------------------------
{
  const d = QUEENS_DIAGRAM;
  const { n, regions, solution } = d;
  ok(regions.length === n * n, 'the Queens diagram does not cover its board');
  ok(new Set(regions).size === n, `the Queens diagram has ${new Set(regions).size} regions, expected ${n}`);
  ok(new Set(solution).size === n, 'the Queens diagram repeats a column');
  ok(new Set(solution.map((c, r) => regions[r * n + c])).size === n,
     'the Queens diagram puts two queens in one colour');
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      ok(!(Math.abs(a - b) <= 1 && Math.abs(solution[a] - solution[b]) <= 1),
         `the Queens diagram has queens touching in rows ${a} and ${b}`);
    }
  }
  // Regions must be single connected shapes, as in a real board.
  for (let region = 0; region < n; region++) {
    const members = new Set();
    regions.forEach((r, cell) => { if (r === region) members.add(cell); });
    const start = members.values().next().value;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const cell = stack.pop();
      const row = (cell / n) | 0, col = cell % n;
      for (const next of [
        row > 0 ? cell - n : -1, row < n - 1 ? cell + n : -1,
        col > 0 ? cell - 1 : -1, col < n - 1 ? cell + 1 : -1
      ]) {
        if (next >= 0 && members.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
    ok(seen.size === members.size, `region ${region} of the Queens diagram is in pieces`);
  }
  // And the picture should show *the* answer, not one of several.
  const solutions = findSolutions(n, regions, 3);
  ok(solutions.some(s => s.join(',') === solution.join(',')),
     'the Queens diagram shows a placement its own board does not allow');
}

// --- Patch -------------------------------------------------------------------
{
  const { n, clues, solution } = PATCH_DIAGRAM;
  ok(clues.length === solution.length, 'the Patch diagram has a number with no box');

  const cover = new Map();
  solution.forEach((rect, i) => {
    const cells = cellsOf(n, rect);
    // Rule 2: the box is the size the number says.
    ok(cells.length === clues[i].area,
       `box ${i} of the Patch diagram covers ${cells.length}, its number says ${clues[i].area}`);
    // Rule 1: one number inside, and it is that number.
    const inside = cells.filter(c => clues.some(x => x.cell === c));
    ok(inside.length === 1 && inside[0] === clues[i].cell,
       `box ${i} of the Patch diagram holds ${inside.length} numbers`);
    for (const cell of cells) cover.set(cell, (cover.get(cell) ?? 0) + 1);
  });
  // Rule 3: the whole board, once each.
  ok(cover.size === n * n, `the Patch diagram covers ${cover.size} of ${n * n} squares`);
  ok([...cover.values()].every(v => v === 1), 'a square in the Patch diagram is covered twice');

  ok(solveAll(n, clues, 3).length === 1, 'the Patch diagram board does not have exactly one solution');
  ok(analyze(n, clues).solved, 'the Patch diagram board cannot be reasoned out');
}

// --- Lamplight ---------------------------------------------------------------
{
  const { n, board, lamps } = LAMPLIGHT_DIAGRAM;
  const puzzle = { n, board, lamps, hard: 0, openers: 0 };

  // Every lamp in the picture is a lamp on the board it claims to be.
  for (const lamp of lamps) {
    ok(board[lamp.cell] === -3, `the Lamplight diagram has a lamp on square ${lamp.cell} that is not one`);
  }
  ok(board.filter(x => x === -3).length === lamps.length,
     'the Lamplight diagram has lamps its answer does not aim');

  // Rule 3, both halves: every non-wall square lit, exactly once.
  const counts = new Map();
  for (const lamp of lamps) {
    for (const cell of beamOf(n, board, lamp.cell, lamp.dir)) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
  }
  const need = board.filter(x => x !== LAMP_WALL).length;
  ok(counts.size === need, `the Lamplight diagram lights ${counts.size} of ${need} squares`);
  ok([...counts.values()].every(v => v === 1), 'a square in the Lamplight diagram is lit twice');

  ok(lampSolve(puzzle, 3).length === 1, 'the Lamplight diagram board does not have exactly one solution');
  const verdict = lampAnalyze(puzzle);
  ok(verdict.solved, 'the Lamplight diagram board cannot be reasoned out');
  ok(verdict.openers >= 1, 'the Lamplight diagram board has no way in');
}

console.log(failures === 0
  ? `diagrams ${checks} assertions, 0 failures`
  : `diagrams ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
