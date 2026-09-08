/*
 * The pictures in "how to play" have to obey the rules they are teaching.
 * Checked with the games' own engines, not by eye.
 */
import { makeEngine } from '../src/games/zip/engine.ts';
import { solveAll, analyze } from '../src/games/comet/engine.ts';
import { findSolutions } from '../src/games/queens/engine.ts';
import { ZIP_DIAGRAM, QUEENS_DIAGRAM , COMET_DIAGRAM } from '../src/components/diagrams.ts';

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

// --- Comet -------------------------------------------------------------------
{
  const { n, clues, solution } = COMET_DIAGRAM;
  ok(clues.length === solution.length, 'the Comet diagram has a comet with no answer');

  // Every square exactly once: the whole of rule three.
  const cover = new Map();
  for (const cells of solution) for (const cell of cells) cover.set(cell, (cover.get(cell) ?? 0) + 1);
  ok(cover.size === n * n, `the Comet diagram covers ${cover.size} of ${n * n} squares`);
  ok([...cover.values()].every(v => v === 1), 'a square in the Comet diagram is claimed twice');

  clues.forEach((clue, i) => {
    const cells = solution[i];
    ok(cells[0] === clue.cell, `Comet ${i} does not start at its own circle`);
    ok(cells.length === clue.len, `Comet ${i} is ${cells.length} long but says ${clue.len}`);
    // Straight, and in one direction only.
    const rows = new Set(cells.map(c => (c / n) | 0));
    const cols = new Set(cells.map(c => c % n));
    ok(rows.size === 1 || cols.size === 1, `Comet ${i} is not a straight line`);
    const line = [...cells].sort((a, b) => a - b);
    for (let k = 1; k < line.length; k++) {
      const step = rows.size === 1 ? 1 : n;
      ok(line[k] - line[k - 1] === step, `Comet ${i} has a gap in it`);
    }
    // A tail may not pass through another circle.
    const heads = new Set(clues.map(c => c.cell));
    ok(cells.slice(1).every(c => !heads.has(c)), `Comet ${i} flies through another circle`);
  });

  // And the picture must show *the* answer, not one of several.
  const solutions = solveAll(n, clues, 3);
  ok(solutions.length === 1, `the Comet diagram board has ${solutions.length} solutions`);
  ok(analyze(n, clues).solved, 'the Comet diagram board cannot be reasoned out');
}

console.log(failures === 0
  ? `diagrams ${checks} assertions, 0 failures`
  : `diagrams ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
