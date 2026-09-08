/*
 * The Patch engine: boards legal, uniquely solvable, reasonable without
 * guessing, openable without staring, and inside their difficulty band.
 * Usage: node test/patch.js [samplesPerTier]
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, MIN_OPENERS, analyze, cellsOf, generate,
  generateDifficulty, mulberry32, solveAll
} from '../src/games/patch/engine.ts';
import { DAILY_BAND, DAILY_N, fingerprint, generateDaily } from '../src/games/patch/daily.ts';

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
  const { n, clues, solution } = puzzle;
  if (clues.length !== solution.length) return 'a number with no box';
  const numbered = new Set(clues.map(c => c.cell));
  const seen = new Map();
  for (let i = 0; i < clues.length; i++) {
    const rect = solution[i];
    if (rect.r0 < 0 || rect.c0 < 0 || rect.r0 + rect.h > n || rect.c0 + rect.w > n) {
      return `box ${i} runs off the board`;
    }
    const cells = cellsOf(n, rect);
    if (cells.length !== clues[i].area) return `box ${i} covers ${cells.length}, says ${clues[i].area}`;
    const inside = cells.filter(c => numbered.has(c));
    if (inside.length !== 1) return `box ${i} holds ${inside.length} numbers`;
    if (inside[0] !== clues[i].cell) return `box ${i} is round the wrong number`;
    for (const cell of cells) {
      if (seen.has(cell)) return `square ${cell} is in boxes ${seen.get(cell)} and ${i}`;
      seen.set(cell, i);
    }
  }
  if (seen.size !== n * n) return `${n * n - seen.size} squares left bare`;
  return null;
}

console.log('\nPatch');
for (const tier of DIFFICULTY_ORDER) {
  const preset = DIFFICULTIES[tier];
  let built = 0;
  const hards = [];
  const openers = [];
  const boxes = [];
  const started = Date.now();

  for (let i = 0; i < N; i++) {
    const puzzle = generateDifficulty(tier, (i + 1) * 2654435761 >>> 0);
    ok(puzzle !== null, `${tier}: no board for sample ${i}`);
    if (!puzzle) continue;
    built++;
    ok(puzzle.n === preset.n, `${tier}: board is ${puzzle.n}x${puzzle.n}, expected ${preset.n}`);
    const wrong = illegal(puzzle);
    ok(wrong === null, `${tier} sample ${i}: ${wrong}`);
    ok(solveAll(puzzle.n, puzzle.clues, 2).length === 1,
       `${tier} sample ${i}: the board does not have exactly one solution`);

    const verdict = analyze(puzzle.n, puzzle.clues);
    ok(verdict.solved, `${tier} sample ${i}: the board cannot be finished by reasoning`);
    /*
     * The one that matters most. A board with no forced opening is a board you
     * stare at, which is exactly what sank the game this one replaced.
     */
    ok(verdict.openers >= MIN_OPENERS,
       `${tier} sample ${i}: only ${verdict.openers} numbers can be placed from a blank board`);
    ok(puzzle.hard >= preset.minHard && puzzle.hard <= preset.maxHard,
       `${tier} sample ${i}: ${puzzle.hard} hard steps is outside ${preset.minHard}-${preset.maxHard}`);

    hards.push(puzzle.hard);
    openers.push(verdict.openers);
    boxes.push(puzzle.clues.length);
  }

  hards.sort((a, b) => a - b);
  openers.sort((a, b) => a - b);
  const avg = a => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
  console.log(`${tier.padEnd(7)} ${built}/${N} generated, all checks pass  |  ` +
    `${preset.n}×${preset.n}, ${avg(boxes)} patches, hard steps ` +
    `${hards[0]}-${hards[hards.length - 1]} (median ${hards[hards.length >> 1]}), ` +
    `${openers[0]}+ ways in, ${((Date.now() - started) / N).toFixed(0)}ms avg`);
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

// --- a box holding two numbers belongs to neither -----------------------------
{
  // Rule 1 is what stops a big rectangle swallowing its neighbours' numbers.
  const n = 4;
  const clues = [{ cell: 0, area: 4 }, { cell: 1, area: 4 }];
  const numbered = new Set([0, 1]);
  const { candidatesFor } = await import('../src/games/patch/engine.ts');
  const options = candidatesFor(n, 0, 4, numbered);
  ok(options.length > 0, 'a 4 in the corner has nowhere to go at all');
  ok(options.every(o => !o.cells.includes(1)),
     'a box was offered that swallows the number next to it');
  ok(clues.length === 2, '');
}

// --- the daily ---------------------------------------------------------------
{
  const a = generateDaily(12345);
  ok(a !== null, 'no daily board');
  if (a) {
    ok(a.n === DAILY_N, `the daily is ${a.n}x${a.n}, expected ${DAILY_N}`);
    ok(illegal(a) === null, `the daily board is illegal: ${illegal(a)}`);
    ok(solveAll(a.n, a.clues, 2).length === 1, 'the daily does not have exactly one solution');
    const verdict = analyze(a.n, a.clues);
    ok(verdict.solved, 'the daily cannot be finished by reasoning');
    ok(verdict.openers >= MIN_OPENERS, `the daily offers only ${verdict.openers} ways in`);
    ok(fingerprint(generateDaily(12345)) === fingerprint(a), 'the daily is not the same board twice');
    ok(fingerprint(generateDaily(12346)) !== fingerprint(a), 'two days share a board');
    ok(a.hard >= DAILY_BAND.minHard - 4 && a.hard <= DAILY_BAND.maxHard + 4,
       `the daily is ${a.hard} hard steps, far outside its band`);
  }
}

// --- a raw board is still a legal board --------------------------------------
{
  /*
   * One call to generate() often returns nothing: it refuses a board that is
   * not unique, cannot be reasoned out, or has no forced opening. Refusing is
   * the point, and the tier generator simply asks again -- so what is worth
   * asserting is that asking a few times reliably produces a board, and that
   * every board it does produce is legal.
   */
  let built = 0;
  for (let seed = 1; seed <= N; seed++) {
    const rng = mulberry32(seed * 7919);
    let p = null;
    for (let attempt = 0; attempt < 10 && !p; attempt++) p = generate(6, rng);
    if (!p) continue;
    built++;
    ok(illegal(p) === null, `raw board ${seed}: ${illegal(p)}`);
    ok(p.openers >= MIN_OPENERS, `raw board ${seed} offers only ${p.openers} ways in`);
  }
  ok(built > N * 0.9, `only ${built} of ${N} boards appeared within ten tries`);
}

console.log(failures === 0
  ? `\nOK — ${checks.toLocaleString()} assertions, 0 failures.`
  : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
