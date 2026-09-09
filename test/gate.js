/*
 * The ready gate, in a real browser.
 *
 * The gate is the first thing anyone sees of a puzzle, and it used to be one tap
 * from losing the day: every control below a covered board was live, and Reveal
 * marked the run as given away without ever saying so -- the honest solve that
 * followed was then never recorded. This suite holds the gate to what it
 * promises: the daily cannot be forfeited from it, the best time beside it is
 * the one the day's play is actually measured against, a day already finished is
 * not offered a Start that leads nowhere, and the board says how hard it is
 * before you commit to it.
 *
 * Usage: node test/gate.js [--shots <dir>]
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('gate  skipped — no Chrome found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

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

/*
 * The chrome is React and the core publishes at most once per animation frame,
 * so a DOM read straight after an action can legitimately see the frame before
 * it. Two frames is the wait that makes an assertion mean something.
 */
const settle = page =>
  page.eval('return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');

/* Missing is a failed assertion, not a crashed suite: a run that stops on the
 * first absent element hides everything after it. */
const click = (page, id) =>
  page.eval(`const el = document.getElementById('${id}'); if (el) el.click(); return !!el;`);
const text = (page, id) =>
  page.eval(`const el = document.getElementById('${id}'); return el && el.textContent`);

/** The solution's cell centres in page coordinates -- enough to solve by hand. */
const POINTS = `
  const z = window.__zip, p = z.state.puzzle;
  const r = document.getElementById('board').getBoundingClientRect();
  const s = r.width / (p.cols * z.U + 2 * z.PAD);
  return p.solution.map(c => ({
    x: r.left + ((c % p.cols) * z.U + 0.5 * z.U + z.PAD) * s,
    y: r.top + (((c / p.cols) | 0) * z.U + 0.5 * z.U + z.PAD) * s
  }));`;

/*
 * Open a game and stop at the gate. Unlike the play suites nothing is uncovered
 * here: the covered board is the subject.
 */
async function openGate(game, opts = {}) {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 390, height: 844, ...opts });
  await page.goto(`${INDEX}#/${game}`);
  await waitForBoard(page, game);
  // A game shows its rules unasked the first time it is opened, and every test
  // runs in a fresh profile, so the sheet would otherwise cover the board.
  if (await page.eval("return !!document.getElementById('rules')")) {
    await click(page, 'rulesClose');
    await sleep(250);
  }
  return page;
}

async function waitForBoard(page, game) {
  for (let i = 0; i < 120; i++) {
    if (await page.eval(`return !!(window.__${game} && window.__${game}.state.puzzle)`)) return;
    await sleep(50);
  }
  throw new Error(`no ${game} board after 6s`);
}

const phase = (page, game = 'zip') => page.eval(`return window.__${game}.state.phase`);

/*
 * A mode switch asks a worker for a board and leaves the previous one on screen
 * meanwhile, so "there is a puzzle" is not the signal -- a covered board in the
 * mode that was asked for is.
 */
async function waitForFreshBoard(page, mode, game = 'zip') {
  for (let i = 0; i < 120; i++) {
    const at = await page.eval(`const s = window.__${game}.state;
      return s.puzzle && s.mode === '${mode}' && s.phase === 'ready';`);
    if (at) return;
    await sleep(50);
  }
  throw new Error(`no covered ${mode} board after 6s`);
}

async function waitForPlaying(page, game = 'zip') {
  for (let i = 0; i < 80; i++) {
    if (await phase(page, game) === 'playing') return true;
    await sleep(100);
  }
  return false;
}

const shot = async (page, name) => { if (shotDir) await page.screenshot(`${shotDir}/${name}.png`); };

try {

// --- the daily cannot be given away from the gate ---------------------------
section('the daily cannot be given away from the gate');
{
  const page = await openGate('zip');
  ok(await page.eval("return window.__zip.core.mode === 'daily'"), 'zip did not open on the daily');
  ok(await phase(page) === 'ready', 'the board was not covered on arrival');

  // The gate must say what it is handing you: a Queens player's first board is
  // the hard tier, and neither game named the tier at all.
  const subtitle = await text(page, 'startBtn');
  ok(/Daily #\d+/.test(subtitle), `the gate does not name the puzzle: "${subtitle}"`);
  ok(/Medium/.test(subtitle), `the gate does not name the tier: "${subtitle}"`);
  ok(/6×6/.test(subtitle), `the gate does not name the size: "${subtitle}"`);
  // "Reveal" here meant "uncover and begin"; the button of that name below means
  // "show me the answer". Two senses, three inches apart.
  ok(!/reveal/i.test(subtitle), `the gate still calls starting a reveal: "${subtitle}"`);
  await shot(page, 'gate-fresh');

  // Reading the rules from the gate must still cost nothing.
  await click(page, 'gateHelpBtn');
  await sleep(500);
  ok(await page.eval("return !!document.getElementById('rules')"), 'the gate link did not open the rules');
  await click(page, 'rulesClose');
  await sleep(400);
  ok(await page.eval('return window.__zip.state.elapsed') === 0, 'reading the rules started the clock');
  ok(await phase(page) === 'ready', 'reading the rules uncovered the board');
  ok(await page.eval("return !!document.getElementById('startBtn')"),
     'closing the rules did not return to the gate');

  /*
   * The rest of the board's controls are just as inert as Reveal, and none of
   * them may quietly spend a hint or start the clock. They are exercised before
   * Reveal deliberately: Restart is what clears a forfeit, so a tap on it after
   * the next block would hide the very thing that block is about.
   */
  for (const id of ['hintBtn', 'undoBtn', 'restartBtn', 'revealBtn']) {
    ok(await page.eval(`return document.getElementById('${id}').disabled === true`),
       `${id} still looks live over a covered board`);
    ok(await click(page, id), `${id} is not on the page`);
    await settle(page);
  }
  ok(await phase(page) === 'ready', 'a control below the gate uncovered the board');
  ok(await page.eval('return window.__zip.core.hintsUsed === 0'), 'Hint was spent on a covered board');
  ok(await page.eval('return window.__zip.state.elapsed') === 0, 'a control below the gate started the clock');
  ok(Number(await text(page, 'filled')) === 0, 'a control below the gate drew on the covered board');

  /*
   * A disabled button swallows the click before any handler runs, so the button
   * itself can no longer say why. The keyboard does not go through the button --
   * it reaches the shell's own guard -- so that is where the spoken refusal has
   * to hold, and it is the path a screen-reader user takes anyway.
   */
  for (const k of ['h', 'u', 'r']) {
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true })); return 1`);
    await settle(page);
  }
  ok(await page.eval('return window.__zip.core.revealed === false'),
     'a key gave the answer away from the gate');
  ok(await phase(page) === 'ready', 'a key uncovered the board from the gate');
  ok(Number(await text(page, 'filled')) === 0, 'the solution was drawn under the cover');
  ok(/Start first/.test(await text(page, 'bannerText') ?? ''),
     `a refused key said nothing: banner reads "${await text(page, 'bannerText')}"`);
  ok(await page.eval("return document.getElementById('banner').className.includes('show')"),
     'the refusal banner is not showing');
  await shot(page, 'gate-refused');

  /*
   * And the day is still winnable from here, with nothing in between that could
   * quietly undo the tap: start, solve honestly, and the result is recorded.
   */
  await click(page, 'startBtn');
  ok(await waitForPlaying(page), 'the count-in never finished');
  await settle(page);

  // Mid-run is where Reveal really costs something, so it asks there too -- and
  // an unanswered question lapses rather than lying in wait.
  await click(page, 'revealBtn');
  await settle(page);
  ok(await text(page, 'revealBtn') === 'Sure?', 'Reveal fired on the first tap mid-run');
  ok(await page.eval('return window.__zip.core.revealed === false'), 'arming Reveal mid-run gave the answer away');
  ok(Number(await text(page, 'filled')) === 0, 'arming Reveal mid-run drew the solution');
  let lapsed = false;
  for (let i = 0; i < 32 && !lapsed; i++) {
    await sleep(250);
    lapsed = await text(page, 'revealBtn') === 'Reveal';
  }
  ok(lapsed, 'an armed Reveal never lapsed, so it lies in wait for the next tap');

  await page.drag(await page.eval(POINTS));
  await sleep(400);
  ok(await page.eval('return window.__zip.state.solved === true'), 'the honest solve did not finish the board');
  const recorded = await page.eval("return localStorage.getItem('zip.daily.' + window.__zip.day)");
  ok(!!recorded, 'an honest solve after a tap on Reveal was not recorded');
  ok(await page.eval("return !document.getElementById('dailyTodo')"),
     'the daily bar still says the day is unsolved after a solve');

  // Practice has nothing at stake, so Reveal there still answers on one tap.
  await page.eval("window.__zip.setMode('practice'); return 1");
  await waitForFreshBoard(page, 'practice');
  await page.eval('window.__zip.reveal(); return 1');
  await settle(page);
  await click(page, 'revealBtn');
  await settle(page);
  const shown = await page.eval(`return {
    filled: Number(document.getElementById('filled').textContent),
    total: Number(document.getElementById('total').textContent)
  }`);
  ok(shown.filled === shown.total, `Reveal in practice filled ${shown.filled} of ${shown.total}`);

  ok(page.consoleErrors.length === 0, `console: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a day already solved is not offered a Start that leads nowhere ---------
section('a day already solved is not offered a Start that leads nowhere');
{
  const page = await openGate('zip');
  /*
   * Seed the day as done, plus a faster earlier day and a much faster practice
   * best. The practice best is the one the status row used to show beside a
   * daily label -- a time the day's play could never beat.
   */
  await page.eval(`
    const day = window.__zip.day;
    localStorage.setItem('zip.daily.' + day,
      JSON.stringify({ v: 1, day, ms: 47000, backtracks: 2, hinted: false }));
    localStorage.setItem('zip.daily.' + (day - 1),
      JSON.stringify({ v: 1, day: day - 1, ms: 41000, backtracks: 0, hinted: false }));
    localStorage.setItem('zip.best.medium', '38000');
    return 1;`);
  await page.reload();
  await waitForBoard(page, 'zip');
  await settle(page);

  ok(await page.eval("return !document.getElementById('startBtn')"),
     'a day already in the books still offers Start, which records nothing');
  const done = await text(page, 'gateDone');
  ok(!!done, 'the finished gate does not show the day as finished');
  ok(/0:47\.0/.test(done ?? ''), `the finished gate does not show the time: "${done}"`);
  ok(/Medium/.test(done ?? '') && /6×6/.test(done ?? ''),
     `the finished gate does not name the tier and size: "${done}"`);
  ok(/2 day streak/.test(done ?? ''), `the finished gate does not show the streak: "${done}"`);
  ok(/next puzzle in \d+[hm]/.test(done ?? ''), `the finished gate gives no next puzzle: "${done}"`);
  ok(await page.eval("return !!document.getElementById('replayBtn')"),
     'no way to play the finished board again');
  ok(await page.eval("return !!document.getElementById('otherGameBtn')"),
     'the finished gate points nowhere else in the collection');
  ok(await page.eval("return !!document.getElementById('shareBtn')"), 'a finished day cannot be shared');
  await shot(page, 'gate-solved');

  // The best beside the daily must be the daily's own, not a practice record
  // for a tier that is not being played.
  const best = await text(page, 'best');
  ok(best === '0:41.0', `the daily shows best "${best}", expected the daily best 0:41.0`);
  const summary = await page.eval(
    "return document.querySelector('#history .history-summary').textContent");
  ok(new RegExp(`best ${best.replace('.', '\\.')}`).test(summary),
     `the status row says best ${best} while the history says "${summary}"`);
  ok(!/0:38\.0/.test(summary + best), 'the practice best is still being quoted in daily mode');

  // Replay is honest work, not a dead end: it uncovers the board again.
  await click(page, 'replayBtn');
  ok(await waitForPlaying(page), 'Play it again did nothing');

  // ...and it cannot overwrite what the day already recorded.
  await page.drag(await page.eval(POINTS));
  await sleep(400);
  const after = await page.eval("return localStorage.getItem('zip.daily.' + window.__zip.day)");
  ok(JSON.parse(after).ms === 47000, `a replay rewrote the day's result to ${JSON.parse(after).ms}ms`);

  // Confirming is a real second tap, not a door that never opens: on a board in
  // play, Reveal asked twice does what it says.
  await click(page, 'revealBtn');
  await settle(page);
  await click(page, 'revealBtn');
  await settle(page);
  ok(await page.eval('return window.__zip.core.revealed === true'), 'a confirmed Reveal did nothing');
  ok(/Revealed/.test(await text(page, 'bannerText') ?? ''),
     `a confirmed Reveal said "${await text(page, 'bannerText')}"`);

  // Restart is the way back from a reveal, and it must stay that way: nothing
  // else clears the flag, and a board stuck as given away records nothing.
  await click(page, 'restartBtn');
  await settle(page);
  ok(await page.eval('return window.__zip.core.revealed === false'),
     'Restart no longer clears a revealed board, so a reveal is now a dead end');

  ok(page.consoleErrors.length === 0, `console: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a board given away does not count, however honestly it is finished ------
section('a board given away does not count, however honestly it is finished');
/*
 * Restart clearing `revealed` used to be the whole story, and it left the door
 * this suite exists to shut standing open: reveal the daily, clear it, copy the
 * answer you were just shown back in, and the result and the streak were
 * written as though you had solved it. The time would have been real, the
 * streak would have been real, and nothing anywhere would have recorded that
 * the board had been seen first.
 *
 * Both halves are checked here, because the first fix broke the second. It
 * writes nothing -- and it still finishes: a solve that produced no banner, no
 * flourish and no tally reads as the game being broken rather than as a rule
 * being applied, which is its own kind of lie.
 */
{
  const page = await openGate('zip');
  const key = "'zip.daily.' + window.__zip.day";
  ok(await page.eval(`return localStorage.getItem(${key})`) === null,
     'the day was already in the books, so nothing below would prove anything');

  await click(page, 'startBtn');
  ok(await waitForPlaying(page), 'the board never came out from behind the gate');

  await click(page, 'revealBtn');
  await settle(page);
  await click(page, 'revealBtn');                 // daily asks before it obeys
  await settle(page);
  ok(await page.eval('return window.__zip.core.revealed === true'), 'the board was not given away');

  await click(page, 'restartBtn');
  await settle(page);
  await page.eval(`
    const z = window.__zip;
    for (const cell of z.state.puzzle.solution) z.step(cell);
    return 1;`);
  await settle(page);
  await sleep(200);

  ok(await page.eval('return window.__zip.state.solved === true'),
     'the board did not finish when the solution was put back in');
  // The sub-line is a <small> inside #bannerText, so one read has both halves.
  const said = await text(page, 'bannerText') ?? '';
  ok(/Solved/.test(said), `a given-away board finished silently: "${said}"`);
  ok(/shown first/.test(said),
     `the banner does not say why the board will not count: "${said}"`);
  ok(await page.eval(`return localStorage.getItem(${key})`) === null,
     'a daily that had been revealed was recorded anyway');
  ok(await page.eval('return window.__zip.core.session.solved === 0'),
     'a given-away board counted towards the session tally');

  ok(page.consoleErrors.length === 0, `console: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- practice keeps its own best ---------------------------------------------
section('practice keeps its own best');
{
  const page = await openGate('zip');
  await page.eval("localStorage.setItem('zip.best.medium', '38000'); return 1");
  await page.eval("window.__zip.setMode('practice'); return 1");
  await waitForFreshBoard(page, 'practice');
  await settle(page);
  ok(await text(page, 'best') === '0:38.0',
     `practice shows best "${await text(page, 'best')}", expected its own 0:38.0`);
  ok(page.consoleErrors.length === 0, `console: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- Queens says how hard its daily is ---------------------------------------
section('Queens says how hard its daily is');
{
  const page = await openGate('queens');
  const subtitle = await text(page, 'startBtn');
  // A first-time player's very first Queens board is the hard tier.
  ok(/Hard/.test(subtitle ?? ''), `the Queens gate does not name the tier: "${subtitle}"`);
  ok(/8×8/.test(subtitle ?? ''), `the Queens gate does not name the size: "${subtitle}"`);
  ok(!/reveal/i.test(subtitle ?? ''), `the Queens gate still calls starting a reveal: "${subtitle}"`);
  await shot(page, 'gate-queens');

  ok(await page.eval("return document.getElementById('revealBtn').disabled === true"),
     'Queens leaves Reveal live over a covered daily');
  await click(page, 'revealBtn');
  await settle(page);
  ok(await page.eval('return window.__queens.core.revealed === false'),
     'Reveal gave the Queens answer away from the gate');
  ok(await phase(page, 'queens') === 'ready', 'Reveal uncovered the Queens board from the gate');
  ok(page.consoleErrors.length === 0, `console: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

console.log(failures === 0
  ? `gate  ${checks} browser assertions, 0 failures`
  : `gate  ${failures} FAILURES`);

} finally {
  await site.close();
}
process.exit(failures === 0 ? 0 : 1);
