/*
 * The Queens engine: placements legal, regions well-formed, boards uniquely
 * solvable, difficulty inside its band. No browser needed.
 * Usage: node test/queens.js [samplesPerTier]
 */
import {
  DIFFICULTIES, DIFFICULTY_ORDER, analyze, countSolutions, findSolutions,
  generateDifficulty, growRegions, mulberry32, samplePlacement
} from '../src/games/queens/engine.ts';

const N = parseInt(process.argv[2] || '40', 10);
let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/** Independently re-check a placement against the rules, not against the generator. */
function legal(n, regions, cols) {
  if (cols.length !== n) return false;
  if (new Set(cols).size !== n) return false;                       // one per column
  if (new Set(cols.map((c, r) => regions[r * n + c])).size !== n) return false;  // one per region
  for (let r = 1; r < n; r++) if (Math.abs(cols[r] - cols[r - 1]) < 2) return false;
  // And no two touching at all, which the row-by-row rule should already cover.
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (Math.abs(a - b) <= 1 && Math.abs(cols[a] - cols[b]) <= 1) return false;
    }
  }
  return true;
}

// --- placements ---------------------------------------------------------------
{
  const rng = mulberry32(9);
  for (let i = 0; i < 200; i++) {
    const n = 6 + (i % 4);
    const cols = samplePlacement(n, rng);
    ok(!!cols, `no placement found for n=${n}`);
    if (!cols) continue;
    ok(new Set(cols).size === n, `placement repeats a column at n=${n}`);
    ok(cols.every((c, r) => r === 0 || Math.abs(c - cols[r - 1]) >= 2),
       `placement puts queens in touching columns at n=${n}`);
  }
}

// --- regions ------------------------------------------------------------------
{
  const rng = mulberry32(21);
  for (let i = 0; i < 60; i++) {
    const n = 6 + (i % 4);
    const cols = samplePlacement(n, rng);
    const regions = growRegions(n, cols, rng);
    ok(regions.length === n * n, `regions do not cover the board at n=${n}`);
    ok(!regions.includes(-1), `some squares were left without a region at n=${n}`);
    ok(new Set(regions).size === n, `expected ${n} regions, got ${new Set(regions).size}`);
    ok(new Set(cols.map((c, r) => regions[r * n + c])).size === n,
       `two queens landed in one region at n=${n}`);

    // Every region has to be one connected shape, or it is not a region.
    for (let region = 0; region < n; region++) {
      const members = new Set();
      regions.forEach((r, cell) => { if (r === region) members.add(cell); });
      const start = members.values().next().value;
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const cell = stack.pop();
        const row = (cell / n) | 0;
        const col = cell % n;
        for (const next of [
          row > 0 ? cell - n : -1, row < n - 1 ? cell + n : -1,
          col > 0 ? cell - 1 : -1, col < n - 1 ? cell + 1 : -1
        ]) {
          if (next >= 0 && members.has(next) && !seen.has(next)) { seen.add(next); stack.push(next); }
        }
      }
      ok(seen.size === members.size, `region ${region} is in ${'>1'} pieces at n=${n}`);
    }
  }
}

// --- generated boards ---------------------------------------------------------
for (const tier of DIFFICULTY_ORDER) {
  const cfg = DIFFICULTIES[tier];
  const guesses = [];
  const times = [];
  let made = 0;
  const before = failures;

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const puzzle = generateDifficulty(tier, 500000 + i);
    times.push(Date.now() - t0);
    if (!puzzle) { failures++; console.log(`  FAIL ${tier}#${i}: generator returned nothing`); continue; }
    made++;

    ok(puzzle.n === cfg.n, `${tier}#${i}: size ${puzzle.n}, expected ${cfg.n}`);
    ok(legal(puzzle.n, puzzle.regions, puzzle.solution),
       `${tier}#${i}: the stored solution breaks the rules`);

    const count = countSolutions(puzzle.n, puzzle.regions, 2);
    ok(count === 1, `${tier}#${i}: ${count} solutions, expected exactly 1`);

    // The one solution the solver finds must be the one that was stored.
    const [found] = findSolutions(puzzle.n, puzzle.regions, 1);
    ok(found?.join(',') === puzzle.solution.join(','),
       `${tier}#${i}: solver disagrees with the stored solution`);

    const stats = analyze(puzzle.n, puzzle.regions, puzzle.solution);
    ok(stats.guesses >= cfg.minGuesses && stats.guesses <= cfg.maxGuesses,
       `${tier}#${i}: ${stats.guesses} guesses, outside [${cfg.minGuesses}, ${cfg.maxGuesses}]`);
    ok(stats.deduced + stats.guesses === puzzle.n,
       `${tier}#${i}: accounted for ${stats.deduced + stats.guesses} of ${puzzle.n} queens`);
    guesses.push(stats.guesses);
  }

  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const sorted = guesses.slice().sort((a, b) => a - b);
  console.log(
    `${tier.padEnd(7)} ${made}/${N} generated, ${failures === before ? 'all checks pass' : 'FAILURES'}  |  ` +
    `${cfg.n}×${cfg.n}, guesses ${sorted[0]}-${sorted[sorted.length - 1]} ` +
    `(median ${sorted[sorted.length >> 1]}), ${avg(times)}ms avg`
  );
}

// --- determinism --------------------------------------------------------------
{
  const a = generateDifficulty('hard', 1234);
  const b = generateDifficulty('hard', 1234);
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same seed produced two different boards');
  const c = generateDifficulty('hard', 1235);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'two different seeds produced the same board');
}

console.log(failures === 0
  ? `\nOK — ${checks.toLocaleString()} assertions, 0 failures.`
  : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
