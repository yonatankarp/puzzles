/*
 * Seeds, in a real browser.
 *
 * Every board comes from one 32-bit number, so two people holding the same
 * number are playing the same board -- that is the whole of racing someone
 * here, and it is only worth anything if the number on screen is the truth.
 *
 * The failure this suite exists for is a quiet one. A seed alone does not
 * identify a board: the generator is entered per tier, so the same number at
 * medium and at expert are unrelated puzzles. A link carrying only the number,
 * or a chip naming a board that has not finished generating, hands two people
 * different puzzles while telling both of them they are racing the same one.
 * Nothing on either screen looks wrong.
 *
 * Usage: node test/seed.js
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('seed  skipped — no Chrome found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

let checks = 0;
let failures = 0;
const started = Date.now();
const section = name => {
  const secs = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
  writeSync(1, `  ${secs}s  ${name}\n`);
};
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

const site = await serve('dist-test');
const INDEX = `${site.origin}/index.html?test`;

const hookOf = game => `window.__${game}`;

/** Open a game and get past the two things that sit over a fresh board. */
async function open(game, hash = `#/${game}`, width = 390) {
  const page = await launch();
  await page.setup({ scheme: 'dark', width, height: 844 });
  await page.goto(INDEX + hash);
  for (let i = 0; i < 160; i++) {
    if (await page.eval(`return !!(${hookOf(game)} && ${hookOf(game)}.state.puzzle)`)) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(400);
  }
  return page;
}

/** The board itself, as a string, so two of them can be compared. */
const boardOf = (page, game) => page.eval(`
  const p = ${hookOf(game)}.state.puzzle;
  return JSON.stringify(p.waypoints ?? p.regions) + '|' + JSON.stringify(p.walls ?? p.solution);`);

/** Wait until a specific tier's board has actually landed. Expert is slow. */
async function settledOn(page, game, tier) {
  for (let i = 0; i < 200; i++) {
    const now = await page.eval(`return ${hookOf(game)}.core.seedTier`);
    if (now === tier && !(await page.eval(`return ${hookOf(game)}.core.busy`))) return true;
    await sleep(50);
  }
  return false;
}

// --- the seed is shown, in both modes ----------------------------------------
section('the seed is shown, in both modes');
for (const game of ['zip', 'queens']) {
  const page = await open(game);
  ok(await page.eval("return !!document.getElementById('seedBtn')"),
     `${game}: the daily does not show its seed`);
  const daily = await page.eval("return document.getElementById('seedCode').textContent");
  ok(/^[0-9A-Z]{1,7}$/.test(daily ?? ''), `${game}: the daily seed reads "${daily}"`);

  // The daily is the same board for everyone today, so its link is just the game.
  const dailyLink = await page.eval(`return ${hookOf(game)}.core.seedLink()`);
  ok(dailyLink.endsWith(`#/${game}`), `${game}: the daily link is ${dailyLink}`);

  await page.eval(`${hookOf(game)}.setMode('practice'); return 1`);
  await sleep(1600);
  const code = await page.eval("return document.getElementById('seedCode').textContent");
  ok(/^[0-9A-Z]{1,7}$/.test(code ?? ''), `${game}: the practice seed reads "${code}"`);
  ok(code !== daily, `${game}: practice reused the daily's seed`);
  ok(page.consoleErrors.length === 0, `${game}: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a seed link carries its tier, or it is not a board ----------------------
section('a seed link carries its tier, or it is not a board');
{
  /*
   * The discriminating case: the person opening the link has a DIFFERENT tier
   * saved. If the link carried only the number, their own tier would decide the
   * board and both players would be racing different puzzles in good faith.
   */
  let page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); window.__zip.setDifficulty('hard'); return 1");
  ok(await settledOn(page, 'zip', 'hard'), 'the hard board never arrived');
  const link = await page.eval('return window.__zip.core.seedLink()');
  const shared = await boardOf(page, 'zip');
  ok(/#\/zip\/s\/hard\/[0-9A-Z]+$/.test(link), `the shared link is ${link}`);
  await page.close();

  page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); window.__zip.setDifficulty('easy'); return 1");
  ok(await settledOn(page, 'zip', 'easy'), 'the easy board never arrived');
  ok(await page.eval("return localStorage.getItem('zip.difficulty')") === 'easy',
     'the receiving profile is not on a different tier, so this proves nothing');
  await page.close();

  page = await open('zip', link.slice(link.indexOf('#')));
  ok(await settledOn(page, 'zip', 'hard'), 'a hard seed link did not land on hard');
  ok(await boardOf(page, 'zip') === shared,
     'a seed link handed the two players different boards');
  ok(await page.eval("return document.getElementById('seedCode').textContent") ===
     link.slice(link.lastIndexOf('/') + 1),
     'the board on screen does not show the seed that was sent');
  ok(page.consoleErrors.length === 0, `seed link: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- the chip never names a board that is not on screen ----------------------
section('the chip never names a board that is not on screen');
{
  /*
   * Expert takes seconds to generate. Naming the seed when it is requested
   * rather than when it lands makes the chip describe one board while another
   * is still up -- and the link then hands over a puzzle nobody played.
   */
  const page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); window.__zip.setDifficulty('medium'); return 1");
  ok(await settledOn(page, 'zip', 'medium'), 'the medium board never arrived');
  const before = await boardOf(page, 'zip');
  const beforeCode = await page.eval("return document.getElementById('seedCode').textContent");

  await page.eval("window.__zip.setDifficulty('expert'); return 1");
  await sleep(120);                       // mid-generation, on purpose
  const during = await page.eval(`return {
    board: JSON.stringify(window.__zip.state.puzzle.waypoints) + '|' + JSON.stringify(window.__zip.state.puzzle.walls),
    code: document.getElementById('seedCode')?.textContent,
    link: window.__zip.core.seedLink()
  }`);
  if (during.board === before) {
    ok(during.code === beforeCode,
       `while generating, the chip named ${during.code} over the board seeded ${beforeCode}`);
    ok(during.link.includes(beforeCode),
       `while generating, the link offered ${during.link} for a board that is not on screen`);
  } else {
    ok(true, 'the expert board arrived too fast to observe the gap');
    ok(true, '');
  }

  ok(await settledOn(page, 'zip', 'expert'), 'the expert board never arrived');
  const after = await page.eval(`return {
    code: document.getElementById('seedCode').textContent,
    link: window.__zip.core.seedLink()
  }`);
  ok(after.code !== beforeCode, 'the seed did not move when the board did');
  ok(after.link.includes('/expert/') && after.link.includes(after.code),
     `the settled link is ${after.link}`);
  await page.close();
}

// --- the tier you tapped last is the tier you get ----------------------------
section('the tier you tapped last is the tier you get');
{
  /*
   * Two generations can be in flight at once, and an easier board builds faster
   * than a harder one. The sequence guard used to be claimed when a board
   * landed rather than when it was asked for, so the first to finish cancelled
   * the other: tapping Medium then Expert left you on Medium. Nothing said so,
   * and the tier label agreed with the board, so the only sign was that the
   * puzzle was easier than the one you asked for.
   */
  const page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); return 1");
  await sleep(1200);

  for (const [first, second] of [['expert', 'easy'], ['easy', 'expert'], ['medium', 'hard']]) {
    await page.eval(`window.__zip.setDifficulty('${first}'); window.__zip.setDifficulty('${second}'); return 1`);
    ok(await settledOn(page, 'zip', second),
       `tapping ${first} then ${second} did not settle on ${second}`);
    ok(await page.eval('return window.__zip.core.seedTier') === second,
       `tapping ${first} then ${second} left the board on ` +
       `${await page.eval('return window.__zip.core.seedTier')}`);
    ok(await page.eval("return document.getElementById('tierStats').textContent.toLowerCase()")
         .then(s => s.startsWith(second)),
       `the label disagrees with the board after ${first} then ${second}`);
  }
  ok(page.consoleErrors.length === 0, `tier race: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- broken links fail visibly, not silently ---------------------------------
section('broken links fail visibly, not silently');
{
  // A seed that cannot be decoded still opens the game it names.
  let page = await open('zip', '#/zip/s/medium/!!!');
  ok(await page.eval('return !!window.__zip'), 'a mistyped seed threw us off the game');
  ok(await page.eval("return !!document.getElementById('board')"), 'a mistyped seed left no board');
  await page.close();

  // A tier this game does not have must say so rather than quietly serve medium.
  page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); return 1");
  await sleep(1200);
  await page.eval("window.__zip.core.loadTier('impossible', 4242); return 1");
  await sleep(600);
  const banner = await page.eval("return document.getElementById('bannerText')?.textContent ?? ''");
  ok(/no impossible board/i.test(banner), `an unknown tier said "${banner}"`);
  ok(await page.eval("return window.__zip.core.seedTier") !== 'impossible',
     'an unknown tier was adopted as the board on screen');
  await page.close();

  // A game that does not exist is not a game.
  page = await launch();
  await page.setup({ scheme: 'dark', width: 390, height: 844 });
  await page.goto(`${INDEX}#/sudoku/s/medium/42`);
  await sleep(1200);
  ok(await page.eval("return !!document.getElementById('index')"),
     'an unknown game rendered something other than the index');
  ok(await page.eval("return localStorage.getItem('sudoku.seenRules')") === null,
     'an unknown game was recorded as having had its rules seen');
  ok(page.consoleErrors.length === 0, `unknown game: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- the chip fits the smallest phone ----------------------------------------
section('the chip fits the smallest phone');
for (const width of [320, 390]) {
  const page = await open('zip', '#/zip', width);
  await page.eval("window.__zip.setMode('practice'); return 1");
  await sleep(1400);
  const m = await page.eval(`
    const b = document.getElementById('seedBtn').getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right)
    };`);
  ok(m.scrollW <= m.clientW + 1, `${width}px: the seed chip made the page scroll (${m.scrollW} > ${m.clientW})`);
  ok(m.right <= m.clientW + 1, `${width}px: the seed chip runs off the edge (${m.right})`);
  ok(m.h >= 22 && m.w >= 60, `${width}px: the seed chip is ${m.w}x${m.h}`);
  await page.close();
}

await site.close();
console.log(failures === 0
  ? `seed  ${checks} browser assertions, 0 failures`
  : `seed  ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
