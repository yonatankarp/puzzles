/*
 * The Comet engine: boards legal, uniquely solvable, reasonable without
 * guessing, and inside their difficulty band. No browser needed.
 * Usage: node test/comet.js [samplesPerTier]
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, analyze, generate, generateDifficulty,
  mulberry32, shapesFor, solveAll
} from '../src/games/comet/engine.ts';
import { DAILY_BAND, DAILY_N, fingerprint, generateDaily } from '../src/games/comet/daily.ts';

const N = parseInt(process.argv[2] || '40', 10);
let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/*
 * Re-check a solved board against the three rules as written, not against the
 * generator that produced it. A generator that is wrong in the same way as its
 * own checker passes every test it has.
 */
function legal(puzzle) {
  const { n, clues, solution } = puzzle;
  if (clues.length !== solution.length) return 'a comet with no answer';
  const heads = new Set(clues.map(c => c.cell));
  const seen = new Map();

  for (let i = 0; i < clues.length; i++) {
    const clue = clues[i];
    const cells = solution[i];
    if (cells[0] !== clue.cell) return `comet ${i} does not start at its circle`;
    // Rule 2: a number is a promise. An unnumbered head promises nothing.
    if (clue.len > 0 && cells.length !== clue.len) return `comet ${i} is ${cells.length} long, says ${clue.len}`;

    const rows = new Set(cells.map(c => (c / n) | 0));
    const cols = new Set(cells.map(c => c % n));
    // Rule 1: straight, one direction, no turns.
    if (rows.size !== 1 && cols.size !== 1) return `comet ${i} is not a straight line`;
    const step = rows.size === 1 ? 1 : n;
    const line = [...cells].sort((a, b) => a - b);
    for (let k = 1; k < line.length; k++) {
      if (line[k] - line[k - 1] !== step) return `comet ${i} has a gap in it`;
    }
    if (rows.size === 1) {
      // A horizontal run must not have wrapped around the edge of the grid.
      if (cols.size !== cells.length) return `comet ${i} wrapped round a row`;
    }
    for (const cell of cells.slice(1)) {
      if (heads.has(cell)) return `comet ${i} flies through another circle`;
      if (cell < 0 || cell >= n * n) return `comet ${i} leaves the board`;
    }
    // Rule 3, half one: nothing claimed twice.
    for (const cell of cells) {
      if (seen.has(cell)) return `square ${cell} is claimed by comets ${seen.get(cell)} and ${i}`;
      seen.set(cell, i);
    }
  }
  // Rule 3, half two: nothing left bare.
  if (seen.size !== n * n) return `${n * n - seen.size} squares left uncovered`;
  return null;
}

console.log('\nComet');
for (const tier of DIFFICULTY_ORDER) {
  const preset = DIFFICULTIES[tier];
  let built = 0;
  const hards = [];
  const shown = [];
  const started = Date.now();

  for (let i = 0; i < N; i++) {
    const puzzle = generateDifficulty(tier, (i + 1) * 2654435761 >>> 0);
    ok(puzzle !== null, `${tier}: no board for sample ${i}`);
    if (!puzzle) continue;
    built++;

    ok(puzzle.n === preset.n, `${tier}: board is ${puzzle.n}x${puzzle.n}, expected ${preset.n}`);
    const wrong = legal(puzzle);
    ok(wrong === null, `${tier} sample ${i}: ${wrong}`);

    // The promise the whole collection makes.
    ok(solveAll(puzzle.n, puzzle.clues, 2).length === 1,
       `${tier} sample ${i}: the board does not have exactly one solution`);
    // And the promise this game makes on top of it.
    const verdict = analyze(puzzle.n, puzzle.clues);
    ok(verdict.solved, `${tier} sample ${i}: the board cannot be finished by reasoning`);
    ok(verdict.hard === puzzle.hard,
       `${tier} sample ${i}: board says ${puzzle.hard} hard steps, analysis says ${verdict.hard}`);
    ok(puzzle.hard >= preset.minHard && puzzle.hard <= preset.maxHard,
       `${tier} sample ${i}: ${puzzle.hard} hard steps is outside ${preset.minHard}-${preset.maxHard}`);

    hards.push(puzzle.hard);
    shown.push(puzzle.clues.filter(c => c.len > 0).length);
  }

  hards.sort((a, b) => a - b);
  const avg = a => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
  console.log(`${tier.padEnd(7)} ${built}/${N} generated, all checks pass  |  ` +
    `${preset.n}×${preset.n}, hard steps ${hards[0]}-${hards[hards.length - 1]} ` +
    `(median ${hards[hards.length >> 1]}), ${avg(shown)} numbers shown, ` +
    `${((Date.now() - started) / N).toFixed(1)}ms avg`);
}

// --- the same seed is the same board -----------------------------------------
{
  const a = generateDifficulty('medium', 4242);
  const b = generateDifficulty('medium', 4242);
  ok(a && b && fingerprint(a) === fingerprint(b), 'the same seed gave two different boards');
  const c = generateDifficulty('medium', 4243);
  ok(c && fingerprint(a) !== fingerprint(c), 'two different seeds gave the same board');
  // A tier is part of a board's identity, not decoration on it.
  const d = generateDifficulty('hard', 4242);
  ok(d && fingerprint(a) !== fingerprint(d), 'the same seed at two tiers gave the same board');
}

// --- withheld numbers are what makes it a puzzle ------------------------------
{
  // The first design showed every length and every board solved itself. If most
  // numbers stop being withheld, that has come back.
  let totalShown = 0, totalClues = 0;
  for (let i = 0; i < N; i++) {
    const p = generateDifficulty('medium', (i + 99) * 40503 >>> 0);
    if (!p) continue;
    totalShown += p.clues.filter(c => c.len > 0).length;
    totalClues += p.clues.length;
  }
  ok(totalShown / totalClues < 0.5,
     `${((totalShown / totalClues) * 100).toFixed(0)}% of lengths are shown; the board will solve itself`);
}

// --- a tail may never pass through a circle ----------------------------------
{
  const n = 4;
  const isHead = new Uint8Array(n * n);
  isHead[0] = 1;
  isHead[2] = 1;
  const shapes = shapesFor(n, 0, 0, isHead);
  const rightward = shapes.filter(s => s.cells.length > 1 && s.cells.every(c => c < n));
  ok(rightward.every(s => !s.cells.includes(2)),
     'a shape was offered that flies through another circle');
  ok(rightward.every(s => s.cells.length <= 2), 'a shape reached past a circle in its way');
}

// --- the daily ---------------------------------------------------------------
{
  const a = generateDaily(12345);
  ok(a !== null, 'no daily board');
  if (a) {
    ok(a.n === DAILY_N, `the daily is ${a.n}x${a.n}, expected ${DAILY_N}`);
    ok(legal(a) === null, `the daily board is illegal: ${legal(a)}`);
    ok(solveAll(a.n, a.clues, 2).length === 1, 'the daily does not have exactly one solution');
    ok(analyze(a.n, a.clues).solved, 'the daily cannot be finished by reasoning');
    ok(fingerprint(generateDaily(12345)) === fingerprint(a), 'the daily is not the same board twice');
    ok(fingerprint(generateDaily(12346)) !== fingerprint(a), 'two days share a board');
    ok(a.hard >= DAILY_BAND.minHard - 6 && a.hard <= DAILY_BAND.maxHard + 6,
       `the daily is ${a.hard} hard steps, far outside its band`);
  }
}

// --- a raw board is still a legal board --------------------------------------
{
  let built = 0;
  for (let seed = 1; seed <= N; seed++) {
    const p = generate(6, mulberry32(seed * 7919));
    if (!p) continue;
    built++;
    ok(legal({ ...p }) === null, `raw board ${seed}: ${legal({ ...p })}`);
  }
  ok(built > N * 0.8, `only ${built} of ${N} raw boards were built at all`);
}

console.log(failures === 0
  ? `\nOK — ${checks.toLocaleString()} assertions, 0 failures.`
  : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
