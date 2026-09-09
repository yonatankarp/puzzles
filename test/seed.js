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

/** The code on screen, once there is one again -- the chip goes while loading. */
async function codeOn(page) {
  for (let i = 0; i < 120; i++) {
    const text = await page.eval("return document.getElementById('seedCode')?.textContent ?? null");
    if (text) return text;
    await sleep(50);
  }
  return null;
}

/*
 * Wait for the chip to show a particular code. Waiting for it merely to EXIST
 * is not enough: while a new board generates, the chip still names the board
 * that is on screen -- correctly -- so a read taken too early gets the previous
 * code and the comparison fails on a slow machine and passes on a fast one.
 */
async function codeBecomes(page, want) {
  for (let i = 0; i < 200; i++) {
    if (await codeOn(page) === want) return true;
    await sleep(50);
  }
  return false;
}

/*
 * The code for a board of this tier, once the chip itself says so. The core can
 * be on the new board a frame or two before React has published it, so reading
 * the chip the moment the core settles hands back the previous board's code --
 * rarely on an idle machine, reliably when the whole suite is running.
 */
async function codeForTier(page, letter) {
  for (let i = 0; i < 160; i++) {
    const text = await page.eval("return document.getElementById('seedCode')?.textContent ?? ''");
    if (new RegExp(`^[A-Z]{2,4}-${letter}-`).test(text)) return text;
    await sleep(50);
  }
  return await page.eval("return document.getElementById('seedCode')?.textContent ?? ''");
}

/** Wait until a specific tier's board has actually landed. Expert is slow. */
/*
 * Settled means the core has the board AND the chip on screen is naming it.
 *
 * This used to ask the core only, and every caller then read #seedCode out of
 * the DOM on the next line. The chip is React and the core publishes at most
 * once an animation frame, so on a machine with something better to do the
 * read landed a frame early and got the previous board's code -- which is how
 * this suite came to report a medium code beside an expert link and call it a
 * bug in the app. The app was right: the chip catches up, and it names the old
 * board rather than the new one in the meantime, which is the safe direction.
 * It is the reading that was too early, twice now, so the wait covers both
 * halves rather than the one that is quick to ask.
 */
async function settledOn(page, game, tier) {
  const hook = hookOf(game);
  for (let i = 0; i < 200; i++) {
    const state = await page.eval(`
      const h = ${hook};
      const chip = document.getElementById('seedCode');
      const link = h.core.seedLink();
      return {
        tier: h.core.seedTier,
        busy: h.core.busy,
        // No chip at all is fine -- not every screen shows one. A chip that
        // disagrees with the link is the board and its name being out of step.
        named: !chip || link.endsWith(chip.textContent)
      };`);
    if (state.tier === tier && !state.busy && state.named) return true;
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
  // A code names its game and its difficulty, not just its number.
  ok(/^[A-Z]{2,4}-[A-Z]-[0-9A-Z]{2,}$/.test(daily ?? ''), `${game}: the daily code reads "${daily}"`);
  ok(daily.startsWith(game === 'zip' ? 'ZIP-D-' : 'QNS-D-'), `${game}: the daily code is "${daily}"`);

  // The daily links to itself, not to a code that would refuse to open.
  const dailyLink = await page.eval(`return ${hookOf(game)}.core.seedLink()`);
  ok(dailyLink.endsWith(`#/${game}`), `${game}: the daily link is ${dailyLink}`);
  ok(await page.eval("return !document.getElementById('seedEnterBtn')"),
     `${game}: the daily tab offers to replace its board with a code`);

  await page.eval(`${hookOf(game)}.setMode('practice'); return 1`);
  await sleep(1600);
  // Wait for a practice code to be on the chip, not merely for time to pass.
  const code = await codeForTier(page, '[EMHX]');
  ok(/^[A-Z]{2,4}-[EMHX]-[0-9A-Z]{2,}$/.test(code ?? ''), `${game}: the practice code reads "${code}"`);
  ok(code !== daily, `${game}: practice reused the daily's code`);
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
  ok(/#\/s\/ZIP-H-[0-9A-Z]+$/.test(link), `the shared link is ${link}`);
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
     'the board on screen does not show the code that was sent');
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
  ok(/-X-/.test(after.code) && after.link.endsWith(after.code),
     `the settled link is ${after.link} for code ${after.code}`);
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
  // A code that fails its check character still opens the game it names.
  let page = await open('zip', '#/s/ZIP-M-BOGUS');
  ok(await page.eval('return !!window.__zip'), 'a mistyped code threw us off the game');
  ok(await page.eval("return !!document.getElementById('board')"), 'a mistyped code left no board');
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
  await page.goto(`${INDEX}#/s/XXX-M-1RGITXWK`);
  await sleep(1200);
  ok(await page.eval("return !!document.getElementById('index')"),
     'an unknown game rendered something other than the index');
  ok(await page.eval("return Object.keys(localStorage).every(k => !k.startsWith('xxx.'))"),
     'an unknown game was recorded as having had its rules seen');
  ok(page.consoleErrors.length === 0, `unknown game: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a code you were given can be typed in -----------------------------------
section('a code you were given can be typed in');
{
  /*
   * Showing a code and giving nowhere to put one is half a feature. The entry
   * has to take what people actually paste -- a whole link, lower case, with
   * spaces -- and it has to refuse a code that fails its check character rather
   * than building the different-but-valid board that typo describes.
   */
  let page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); window.__zip.setDifficulty('hard'); return 1");
  ok(await settledOn(page, 'zip', 'hard'), 'the hard board never arrived');
  const code = await codeForTier(page, 'H');
  const board = await boardOf(page, 'zip');
  await page.close();

  page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); window.__zip.setDifficulty('easy'); return 1");
  ok(await settledOn(page, 'zip', 'easy'), 'the easy board never arrived');
  ok(await page.eval("return !!document.getElementById('seedEnterBtn')"),
     'there is nowhere to put a code you were given');

  /*
   * React keeps the input's value on the DOM node, so assigning .value directly
   * never reaches it. Going through the prototype setter and firing an input
   * event is what a real keystroke looks like from React's side.
   */
  const type = async (text) => {
    await page.eval("document.getElementById('seedEnterBtn')?.click(); return 1");
    await sleep(250);
    const script =
      "const i = document.getElementById('seedInput');" +
      "const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;" +
      "set.call(i, " + JSON.stringify(text) + ");" +
      "i.dispatchEvent(new Event('input', { bubbles: true }));" +
      "document.getElementById('seedGoBtn').click();" +
      "return 1;";
    return page.eval(script);
  };

  // Lower case, because that is what a phone keyboard and a paste will give.
  await type(code.toLowerCase());
  ok(await settledOn(page, 'zip', 'hard'), 'a typed code did not load its board');
  ok(await boardOf(page, 'zip') === board, 'a typed code loaded a different board');
  ok(await codeBecomes(page, code), `a typed code landed on ${await codeOn(page)}, not ${code}`);

  // One wrong character must be caught by the check character.
  const typo = code.slice(0, -1) + (code.slice(-1) === 'A' ? 'B' : 'A');
  await type(typo);
  await sleep(400);
  ok(/not a board code/i.test(await page.eval("return document.getElementById('seedProblem')?.textContent ?? ''")),
     'a mistyped code was not refused');
  ok(await codeOn(page) === code, 'a mistyped code moved us off the board we were on');

  // A whole link pasted in, which is what gets sent in a message.
  await page.eval("document.getElementById('seedInput') || document.getElementById('seedEnterBtn').click(); return 1");
  await sleep(200);
  await type(`https://example.com/puzzles/#/s/${code}`);
  await sleep(600);
  ok(await codeBecomes(page, code), `a pasted link landed on ${await codeOn(page)}, not ${code}`);
  ok(page.consoleErrors.length === 0, `code entry: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a daily board cannot be replayed ----------------------------------------
section('a daily board cannot be replayed');
{
  /*
   * Not tidiness. Loading today's daily seed as a practice board lets you learn
   * the board, then go to the daily tab and record a time for a puzzle you have
   * already solved. The time would be real, the streak would be real, and
   * nothing anywhere would show that the board had been seen before. The code
   * is on screen so two people can check they are on the same daily; it is not
   * a way to open one.
   */
  let page = await open('zip');
  const daily = await page.eval("return document.getElementById('seedCode').textContent");
  ok(/-D-/.test(daily), `the daily code is "${daily}"`);
  const board = await boardOf(page, 'zip');
  await page.close();

  // The link a daily code makes must land on the daily, not on a copy of it.
  page = await open('zip', `#/s/${daily}`);
  await sleep(1000);
  ok(await page.eval("return window.__zip.state.mode") === 'daily',
     'a daily code opened something other than the daily');
  ok(await boardOf(page, 'zip') === board, 'a daily code opened a replay of the daily');
  await page.close();

  // And the core refuses it however it is reached, not just through the UI.
  page = await open('zip');
  await page.eval("window.__zip.setMode('practice'); return 1");
  await sleep(1400);
  const was = await codeOn(page);
  await page.eval("window.__zip.core.loadBoardCode('daily', 12345); return 1");
  await sleep(700);
  ok(/cannot be replayed/i.test(await page.eval("return document.getElementById('bannerText')?.textContent ?? ''")),
     'replaying a daily was refused silently, or not at all');
  ok(await codeOn(page) === was, 'a refused daily replay still changed the board');
  ok(await page.eval("return window.__zip.state.mode") === 'practice',
     'a refused daily replay moved the player out of practice');
  ok(page.consoleErrors.length === 0, `daily replay: ${page.consoleErrors.join(' | ')}`);
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
