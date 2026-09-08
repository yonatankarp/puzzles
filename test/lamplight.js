/*
 * The Lamplight engine: boards legal, uniquely solvable, reasonable without
 * guessing, openable without staring, and inside their difficulty band.
 * Usage: node test/lamplight.js [samplesPerTier]
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, LAMP, WALL, analyze, beamOf, build,
  generate, generateDifficulty, mulberry32, nextRound, shapesFor, solveAll
} from '../src/games/lamplight/engine.ts';
import { DAILY_BAND, DAILY_N, fingerprint, generateDaily } from '../src/games/lamplight/daily.ts';

const N = parseInt(process.argv[2] || '20', 10);
let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/*
 * Re-check a solved board against the three rules as written, not against the
 * generator that made it. A generator wrong in the same way as its own checker
 * passes every test it has.
 */
function illegal(puzzle) {
  const { n, board, lamps } = puzzle;
  if (board.length !== n * n) return 'the board is the wrong size';
  const marked = board.filter(x => x === LAMP).length;
  if (marked !== lamps.length) return `${marked} lamps drawn, ${lamps.length} aimed`;

  const counts = new Map();
  for (const lamp of lamps) {
    if (board[lamp.cell] !== LAMP) return `a lamp is aimed from square ${lamp.cell}, which is not one`;
    if (lamp.dir < 0 || lamp.dir > 3) return `a lamp shines in direction ${lamp.dir}`;
    const run = beamOf(n, board, lamp.cell, lamp.dir);
    if (run[0] !== lamp.cell) return 'a beam does not start at its lamp';
    // Rule 2: straight, and stopping only at a wall, a lamp, or the edge.
    const rows = new Set(run.map(c => (c / n) | 0));
    const cols = new Set(run.map(c => c % n));
    if (rows.size !== 1 && cols.size !== 1) return 'a beam is not straight';
    for (const cell of run.slice(1)) {
      if (board[cell] === WALL) return 'a beam runs through a wall';
      if (board[cell] === LAMP) return 'a beam runs through another lamp';
    }
    for (const cell of run) counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  // Rule 3, both halves.
  for (const [cell, seen] of counts) {
    if (seen > 1) return `square ${cell} is lit ${seen} times`;
  }
  const need = board.filter(x => x !== WALL).length;
  if (counts.size !== need) return `${need - counts.size} squares are never lit`;
  return null;
}

console.log('\nLamplight');
for (const tier of DIFFICULTY_ORDER) {
  const preset = DIFFICULTIES[tier];
  let built = 0;
  const hards = [];
  const openers = [];
  const lamps = [];
  const started = Date.now();

  for (let i = 0; i < N; i++) {
    const puzzle = generateDifficulty(tier, (i + 1) * 2654435761 >>> 0);
    ok(puzzle !== null, `${tier}: no board for sample ${i}`);
    if (!puzzle) continue;
    built++;
    ok(puzzle.n === preset.n, `${tier}: board is ${puzzle.n}x${puzzle.n}, expected ${preset.n}`);
    const wrong = illegal(puzzle);
    ok(wrong === null, `${tier} sample ${i}: ${wrong}`);
    ok(solveAll(puzzle, 2).length === 1,
       `${tier} sample ${i}: the board does not have exactly one solution`);

    const verdict = analyze(puzzle);
    ok(verdict.solved, `${tier} sample ${i}: the board cannot be finished by reasoning`);
    /*
     * The one that matters most. A board with no forced opening is a board you
     * stare at, which is what sank an earlier game in this collection.
     */
    ok(verdict.openers >= 1, `${tier} sample ${i}: no lamp can be placed from a dark board`);
    ok(puzzle.hard >= preset.minHard && puzzle.hard <= preset.maxHard,
       `${tier} sample ${i}: ${puzzle.hard} hard steps is outside ${preset.minHard}-${preset.maxHard}`);

    hards.push(puzzle.hard);
    openers.push(verdict.openers);
    lamps.push(puzzle.lamps.length);
  }

  hards.sort((a, b) => a - b);
  const avg = a => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
  console.log(`${tier.padEnd(7)} ${built}/${N} generated, all checks pass  |  ` +
    `${preset.n}×${preset.n}, ${avg(lamps)} lamps, hard steps ` +
    `${hards[0]}-${hards[hards.length - 1]} (median ${hards[hards.length >> 1]}), ` +
    `${Math.min(...openers)}+ ways in, ${((Date.now() - started) / N).toFixed(0)}ms avg`);
}

// --- the same seed is the same board -----------------------------------------
{
  const a = generateDifficulty('medium', 4242);
  const b = generateDifficulty('medium', 4242);
  ok(a && b && fingerprint(a) === fingerprint(b), 'the same seed gave two different boards');
  ok(a && fingerprint(a) !== fingerprint(generateDifficulty('medium', 4243)),
     'two different seeds gave the same board');
  ok(a && fingerprint(a) !== fingerprint(generateDifficulty('hard', 4242)),
     'the same seed at two tiers gave the same board');
}

// --- nothing about a beam is hidden ------------------------------------------
{
  /*
   * The rule the whole game rests on: a beam stops at a wall, a lamp, or the
   * edge, and never anywhere else. An earlier design hid how far a beam
   * reached, and became a board nobody could read.
   */
  const n = 5;
  const board = new Array(n * n).fill(-1);
  board[12] = LAMP;          // middle
  board[10] = WALL;          // the left end of its row
  board[14] = LAMP;          // another lamp to its right
  const puzzle = { n, board, lamps: [{ cell: 12, dir: 0 }], hard: 0, openers: 0 };

  ok(beamOf(n, board, 12, 2).join(',') === '12,11', 'a beam did not stop at the wall beside it');
  ok(beamOf(n, board, 12, 3).join(',') === '12,13', 'a beam did not stop at the lamp beside it');
  ok(beamOf(n, board, 12, 0).join(',') === '12,7,2', 'a beam did not run to the edge');
  ok(shapesFor(puzzle, 12).length === 4, 'a lamp in the open has fewer than four ways to shine');

  // A lamp boxed in on every side has one way to shine: itself.
  const boxed = new Array(9).fill(-1);
  boxed[4] = LAMP;
  boxed[1] = WALL; boxed[3] = WALL; boxed[5] = WALL; boxed[7] = WALL;
  const tight = { n: 3, board: boxed, lamps: [{ cell: 4, dir: 0 }], hard: 0, openers: 0 };
  ok(shapesFor(tight, 4).length === 1, 'a boxed-in lamp was offered more than one shape');
}

// --- turning goes round the compass ------------------------------------------
{
  // up, right, down, left, out. Stepping through the direction table in its own
  // order sends the beam up, then DOWN, which does not read as turning at all.
  const seen = [];
  let dir = -1;
  for (let i = 0; i < 5; i++) { dir = nextRound(dir); seen.push(dir); }
  ok(seen.join(',') === '0,3,1,2,-1', `turning a lamp goes ${seen.join(', ')}`);
}

// --- the daily ---------------------------------------------------------------
{
  const a = generateDaily(12345);
  ok(a !== null, 'no daily board');
  if (a) {
    ok(a.n === DAILY_N, `the daily is ${a.n}x${a.n}, expected ${DAILY_N}`);
    ok(illegal(a) === null, `the daily board is illegal: ${illegal(a)}`);
    ok(solveAll(a, 2).length === 1, 'the daily does not have exactly one solution');
    const verdict = analyze(a);
    ok(verdict.solved, 'the daily cannot be finished by reasoning');
    ok(verdict.openers >= 1, 'the daily has no way in');
    ok(fingerprint(generateDaily(12345)) === fingerprint(a), 'the daily is not the same board twice');
    ok(fingerprint(generateDaily(12346)) !== fingerprint(a), 'two days share a board');
    ok(a.hard >= DAILY_BAND.minHard - 5 && a.hard <= DAILY_BAND.maxHard + 5,
       `the daily is ${a.hard} hard steps, far outside its band`);
  }
}

// --- a raw board is still a legal board --------------------------------------
{
  let made = 0;
  for (let seed = 1; seed <= N; seed++) {
    const rng = mulberry32(seed * 7919);
    let puzzle = null;
    for (let attempt = 0; attempt < 10 && !puzzle; attempt++) puzzle = generate(6, rng);
    if (!puzzle) continue;
    made++;
    ok(illegal(puzzle) === null, `raw board ${seed}: ${illegal(puzzle)}`);
    ok(puzzle.openers >= 1, `raw board ${seed} has no way in`);
  }
  ok(made > N * 0.9, `only ${made} of ${N} boards appeared within ten tries`);

  // build() alone may fail; that is its right, and generate() simply asks again.
  const attempt = build(6, mulberry32(1));
  ok(attempt === null || illegal(attempt) === null, 'build made an illegal board');
}

console.log(failures === 0
  ? `\nOK — ${checks.toLocaleString()} assertions, 0 failures.`
  : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
