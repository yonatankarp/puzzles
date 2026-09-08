/*
 * How a Queens board feels, as opposed to whether it is correct.
 *
 * The engine suite (test/queens.js) proves the boards are solvable and the
 * render suite proves the game plays. This one covers the feedback: that the
 * colours follow the theme you actually chose, that a queen which breaks the
 * board is not congratulated for it by the sound, the meter or the screen
 * reader, and that finishing a board is worth watching.
 *
 * Usage: node test/queens-feel.js [--shots <dir>]
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('queens-feel  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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
const URL = `${site.origin}/index.html?test#/queens`;

/* The core publishes at most once per animation frame, so a DOM read straight
 * after an action can legitimately see the previous frame. */
const settle = page =>
  page.eval('return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');

/*
 * Wait for the hooks, get the first-visit rules sheet out of the way -- it sits
 * over the board and swallows real clicks -- and put a known board up. The
 * board arrives covered, and a covered board is painted in the board colour
 * rather than in region tints, so it has to be uncovered before anything here
 * can look at a colour.
 */
const prep = async (page, seed = 4242) => {
  for (let i = 0; i < 120; i++) {
    if (await page.eval('return !!(window.__queens && window.__queens.state.puzzle)')) break;
    await sleep(50);
  }
  if (!await page.eval('return !!window.__queens')) throw new Error('Queens never mounted');
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(300);
  }
  await page.eval("window.__queens.setMode('practice'); return 1");
  await page.eval(`window.__queens.load(window.__queens.generate('medium', ${seed})); return 1`);
  await page.eval('window.__queens.reveal(); return 1');
  await settle(page);
  return page;
};

const open = async (opts = {}) => {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900, ...opts });
  await page.goto(URL);
  return prep(page);
};

/*
 * The lightness of the region tints, which is the only thing that says which
 * palette the board thinks it is in: hsl(h 42% 26%) dark, hsl(h 62% 84%) light.
 * Read off the fills group -- the first <g> under the board svg.
 */
const tint = page => page.eval(`
  const g = document.querySelector('#board > g');
  const fills = [...g.children].map(r => r.getAttribute('fill'));
  const light = fills.filter(f => /84%\\)$/.test(f)).length;
  const dark = fills.filter(f => /26%\\)$/.test(f)).length;
  return { light, dark, total: fills.length, sample: fills[0], clip: g.getAttribute('clip-path') };`);

const cycleTheme = async page => {
  await page.eval("document.getElementById('themeBtn').click(); return 1");
  await sleep(250);
};

const announcement = page =>
  page.eval("return document.getElementById('announcer').textContent");

const meter = async page => {
  await settle(page);
  return page.eval(`
    return {
      filled: document.getElementById('filled').textContent,
      total: document.getElementById('total').textContent,
      label: document.querySelector('.board-region').getAttribute('aria-label')
    };`);
};

try {

// --- the tints follow the theme you actually chose ---------------------------
section('the tints follow the theme you actually chose');
/*
 * The failing combination was a dark system with light pinned: styles.css takes
 * dark as the base and applies light under the media query OR the pin, so
 * asking the media query first gets the answer backwards for exactly the people
 * who press the theme button once. That is the first tap for every dark-system
 * player, and it persists across reloads.
 */
{
  const page = await open({ scheme: 'dark' });

  const system = await tint(page);
  ok(system.total > 0, 'no region fills were drawn at all');
  ok(system.dark === system.total,
     `dark system, theme unset: ${system.light} of ${system.total} fills are light tints`);

  // The base is rounded; square fills painted over its corners squared it off.
  const shape = await page.eval(`
    const base = document.querySelector('#board > rect');
    return { rx: base.getAttribute('rx'), clip: document.querySelector('#board > g').getAttribute('clip-path') };`);
  ok(shape.rx === '14', `the board base lost its rounded corners (rx ${shape.rx})`);
  ok(/^url\(#/.test(shape.clip ?? ''),
     `the region fills are not clipped to the board (clip-path ${shape.clip})`);

  await cycleTheme(page);                       // system -> light
  ok(await page.eval('return document.documentElement.dataset.theme') === 'light',
     'one press of the theme button did not pin light');
  const pinned = await tint(page);
  ok(pinned.light === pinned.total,
     `dark system, light pinned: ${pinned.dark} of ${pinned.total} fills are still dark tints`);
  if (shotDir) await page.screenshot(`${shotDir}/queens-dark-system-light-pinned.png`);

  // Pinning is a stored preference, so the wrong answer used to survive a reload.
  await page.reload();
  await prep(page);
  ok(await page.eval('return document.documentElement.dataset.theme') === 'light',
     'the pinned theme did not survive a reload');
  const reloaded = await tint(page);
  ok(reloaded.light === reloaded.total,
     `after a reload with light pinned: ${reloaded.dark} of ${reloaded.total} fills are dark tints`);

  await cycleTheme(page);                       // light -> dark
  const dark = await tint(page);
  ok(dark.dark === dark.total,
     `dark pinned: ${dark.light} of ${dark.total} fills are light tints`);
  ok(page.consoleErrors.length === 0, `theme errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- and follow it the moment it changes -------------------------------------
section('and follow it the moment it changes');
/*
 * Every other colour on the board is a var() the browser re-resolves, so the
 * rest of the board answered a theme change immediately and the regions did
 * not -- they were baked when the puzzle was set. On a light system the pin
 * that matters is the dark one.
 */
{
  const page = await open({ scheme: 'light' });
  const before = await tint(page);
  ok(before.light === before.total,
     `light system, theme unset: ${before.dark} of ${before.total} fills are dark tints`);

  await cycleTheme(page);                       // system -> light
  await cycleTheme(page);                       // light -> dark
  ok(await page.eval('return document.documentElement.dataset.theme') === 'dark',
     'two presses of the theme button did not pin dark');
  const after = await tint(page);
  ok(after.dark === after.total,
     `light system, dark pinned: ${after.light} of ${after.total} fills did not repaint`);
  ok(page.consoleErrors.length === 0, `live theme errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a clash is not rewarded --------------------------------------------------
section('a clash is not rewarded');
{
  const page = await open({ scheme: 'dark' });

  /*
   * Capture what the app asks the speakers and the motor for, rather than
   * listening. The stub has to be in place before any sound is made: the real
   * Audio caches its context on first use, and a cached real one would make
   * this inert. Nothing is audible while sound is off, so nothing is cached
   * until the button below is pressed.
   */
  await page.eval(`
    window.__tones = [];
    window.__vibes = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true, value: p => { window.__vibes.push(p); return true; }
    });
    window.AudioContext = class {
      constructor() { this.currentTime = 0; this.destination = {}; }
      createOscillator() {
        const t = { type: 'sine', freq: 0, level: 0 };
        window.__tones.push(t);
        return {
          get type() { return t.type; }, set type(v) { t.type = v; },
          frequency: { setValueAtTime: f => { t.freq = f; } },
          connect() {}, start() {}, stop() {}
        };
      }
      createGain() {
        const t = window.__tones[window.__tones.length - 1];
        return {
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime(v) { if (t && v > t.level) t.level = v; }
          },
          connect() {}
        };
      }
    };
    return 1;`);

  // Sound starts off; one press of the speaker button is 'every step'.
  await page.eval("document.getElementById('soundBtn').click(); return 1");
  await settle(page);
  ok(await page.eval("return getComputedStyle(document.getElementById('soundWaveFar')).display !== 'none'"),
     'one press of the speaker button did not reach the loudest setting');

  /*
   * Haptics are refused before the page has been touched, so the app holds them
   * back until it has been. One real tap arms that; the hooks never would.
   */
  const geo = await page.eval(`
    const r = document.getElementById('board').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, n: window.__queens.state.puzzle.n };`);
  const cellAt = (row, col) => ({
    x: Math.round(geo.left + (col + 0.5) * (geo.w / geo.n)),
    y: Math.round(geo.top + (row + 0.5) * (geo.w / geo.n))
  });
  const corner = cellAt(geo.n - 1, geo.n - 1);
  await page.drag([corner, corner]);
  await sleep(200);
  await page.eval('window.__queens.restart(); return 1');
  await settle(page);

  const cells = await page.eval(`
    const p = window.__queens.state.puzzle, n = p.n;
    const first = 0 * n + p.solution[0];
    const clashCol = (p.solution[0] + 3) % n;
    return { first, clash: 0 * n + clashCol, n, firstCol: p.solution[0] + 1, clashCol: clashCol + 1 };`);
  ok(cells.first !== cells.clash, 'the two test cells are the same square');

  // A queen that is legal where it lands: the rising chime and a single tap.
  const legal = await page.eval(`
    const q = window.__queens;
    q.cycle(${cells.first});                    // empty -> crossed off
    window.__tones = []; window.__vibes = [];
    q.cycle(${cells.first});                    // crossed off -> queen
    return { tones: window.__tones, vibes: window.__vibes, conflicts: q.state.conflicts.length };`);
  ok(legal.conflicts === 0, `the first queen on an empty board reported ${legal.conflicts} conflicts`);
  ok(legal.tones.length >= 2, `a legal queen made ${legal.tones.length} tones`);
  ok(legal.tones[0]?.freq > 500,
     `a legal queen's first tone was ${legal.tones[0]?.freq}Hz, not the rising chime`);
  ok(legal.tones[1]?.freq > legal.tones[0]?.freq, 'the reward chime does not rise');
  ok(legal.vibes[0] === 8, `a legal queen buzzed ${JSON.stringify(legal.vibes[0])}`);
  const legalSaid = await announcement(page);
  ok(legalSaid.includes(`row 1, column ${cells.firstCol}`),
     `a legal queen announced "${legalSaid}"`);
  ok(!/clash/i.test(legalSaid), `a legal queen was announced as a clash: "${legalSaid}"`);

  // The same move into a square it cannot hold: a different sound entirely.
  const clash = await page.eval(`
    const q = window.__queens;
    q.cycle(${cells.clash});
    window.__tones = []; window.__vibes = [];
    q.cycle(${cells.clash});
    return { tones: window.__tones, vibes: window.__vibes, conflicts: q.state.conflicts.length };`);
  ok(clash.conflicts === 2, `two queens sharing a row reported ${clash.conflicts} conflicts`);
  ok(clash.tones.length >= 2, `a clashing queen made ${clash.tones.length} tones`);
  ok(clash.tones.every(t => t.freq < 400),
     `a clashing queen still got the reward chime (${clash.tones.map(t => t.freq).join(', ')}Hz)`);
  ok(clash.tones[1]?.freq < clash.tones[0]?.freq, 'the clash cue rises instead of falling');
  ok(Array.isArray(clash.vibes[0]),
     `a clashing queen buzzed ${JSON.stringify(clash.vibes[0])}, the same shape as a good one`);

  // --- and it is said out loud ------------------------------------------------
  const said = await announcement(page);
  ok(said.includes(`row 1, column ${cells.clashCol}`),
     `the clashing queen's own square was not announced: "${said}"`);
  ok(/clashes with the queen at row 1, column /i.test(said),
     `the clash was not announced at all: "${said}"`);
  ok(said.includes('same row'), `the clash was announced without a reason: "${said}"`);

  // --- and the meter agrees with the board ------------------------------------
  /*
   * Both queens are ringed in red, so neither is standing: a meter that counted
   * them would say 2 of 7 while the board says the position is broken.
   */
  const during = await meter(page);
  ok(during.filled === '0', `two clashing queens moved the meter to ${during.filled} of ${during.total}`);
  ok(during.label.includes('0 of 7 queens settled'),
     `the spoken meter reads "${during.label}"`);
  ok(during.label.includes('2 queens clash'),
     `the spoken meter does not mention the clash: "${during.label}"`);

  await page.eval(`window.__queens.cycle(${cells.clash}); return 1`);   // queen -> empty
  const after = await meter(page);
  ok(after.filled === '1',
     `taking the clashing queen back left the meter at ${after.filled}`);
  ok(page.consoleErrors.length === 0, `clash errors: ${page.consoleErrors.join(' | ')}`);

  // --- the win is worth watching ----------------------------------------------
  section('the win is worth watching');
  /*
   * Zip finishes with a sweep down the route and a pop of the board. Queens had
   * neither: it just stopped, wearing every grey cross-off mark you had made.
   */
  await page.eval('window.__queens.restart(); return 1');
  await settle(page);
  const crossed = await page.eval(`
    const q = window.__queens, p = q.state.puzzle, n = p.n;
    for (let r = 0; r < n; r++) q.cycle(r * n + ((p.solution[r] + 2) % n));
    return q.state.marks.filter(m => m === 'blocked').length;`);
  ok(crossed > 0, 'the board under test carries no cross-off marks to clear');

  /*
   * Watch the whole flourish from inside the page rather than sleeping and
   * taking one look. A staggered animation sampled from Node is a race: under
   * the load of a full suite run the single look lands after everything has
   * finished, and a passing feature reports as broken.
   */
  const flourish = await page.eval(`
    const q = window.__queens, p = q.state.puzzle, n = p.n;
    const b = document.getElementById('board');
    // A crown is mid-pop when it carries a scale that is not the resting one.
    const rising = () => [...b.querySelectorAll('path')]
      .map(c => c.getAttribute('transform') || '')
      .filter(t => /scale\\(/.test(t) && !/scale\\(1\\.000\\)/.test(t));
    const crossOpacities = () => [...b.querySelectorAll('g[transform]')]
      .map(g => Number(g.getAttribute('opacity')));

    p.solution.forEach((col, row) => q.place(row * n + col));
    const solved = q.state.solved;

    return new Promise(resolve => {
      const rose = new Set();
      let won = false, together = 0, partlyFaded = false;
      const t0 = performance.now();
      const step = () => {
        won = won || b.classList.contains('won');
        const now = rising();
        together = Math.max(together, now.length);
        for (const t of now) rose.add(t.split(' ')[0]);      // its translate names the cell
        if (crossOpacities().some(v => v > 0 && v < 0.6)) partlyFaded = true;
        if (performance.now() - t0 < 1500) return requestAnimationFrame(step);
        resolve({
          n, solved, won, together, rose: rose.size, partlyFaded,
          crossesLeft: crossOpacities().filter(v => v > 0).length,
          stillScaled: rising().length
        });
      };
      requestAnimationFrame(step);
    });`);

  ok(flourish.solved === true, 'the solution was not recognised as a solve');
  ok(flourish.won, 'the board did not pop on the solve');
  ok(flourish.rose === flourish.n,
     `${flourish.rose} of ${flourish.n} crowns rose on the solve`);
  ok(flourish.together > 0 && flourish.together < flourish.n,
     `${flourish.together} crowns rose at once: they are not staggered`);
  ok(flourish.partlyFaded, 'the cross-off marks vanished instantly rather than fading');
  ok(flourish.crossesLeft === 0,
     `${flourish.crossesLeft} cross-off marks are still on the solved board`);
  ok(flourish.stillScaled === 0, `${flourish.stillScaled} crowns were left mid-pop`);
  if (shotDir) await page.screenshot(`${shotDir}/queens-win.png`);
  ok(page.consoleErrors.length === 0, `win errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- the board can be played without a pointer --------------------------------
section('the board can be played without a pointer');
/*
 * Queens registered pointer events and nothing else: with the board region
 * focused, every arrow, space, enter and X left the state byte-identical, and
 * the only key that put a queen down was H, which counts as a hint. The board
 * region calls itself role="application", which tells a screen reader to hand
 * every key straight to the game and switch browse mode off -- so the keys not
 * existing cost more than a gap, it turned reading the grid off as well.
 *
 * Real KeyboardEvents on `document`, which is where the shell listens, rather
 * than the hooks: a hook would pass with no key handling at all.
 */
{
  const page = await open({ scheme: 'dark' });
  const press = (...keys) => page.eval(`
    for (const k of ${JSON.stringify(keys)}) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }
    return 1;`);
  const cursor = () => page.eval('return window.__queens.state.cursor');
  const n = await page.eval('return window.__queens.state.puzzle.n');

  await page.eval('window.__queens.restart(); return 1');
  await settle(page);
  ok(await cursor() === -1, 'a board nobody has typed on already shows a cursor');

  // The first arrow asks for a cursor rather than moving one that is not there.
  await press('ArrowRight');
  ok(await cursor() === 0, `the first arrow key left the cursor at ${await cursor()}`);
  await press('ArrowDown', 'ArrowRight');
  ok(await cursor() === n + 1, `three arrows walked to ${await cursor()}, not row 2 column 2`);

  // Each move is spoken, because the cursor is the one thing on this board a
  // screen reader cannot see for itself.
  const moved = await announcement(page);
  ok(moved.includes('Row 2, column 2'), `an arrow key announced "${moved}"`);
  ok(/region \d/.test(moved),
     `the cursor does not say which region it is in: "${moved}"`);

  // The edge holds it; wrapping round to the far side would lose the player.
  await press('ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft');
  ok(await cursor() === 0, `the cursor ran off the corner to ${await cursor()}`);

  // Space runs the same cycle a tap does: empty, crossed off, queen, empty.
  await press(' ');
  ok(await page.eval("return window.__queens.state.marks[0]") === 'blocked',
     'space did not cross the square off');
  const crossed = await announcement(page);
  ok(/crossed off/i.test(crossed), `crossing off by key announced "${crossed}"`);
  await press('Enter');
  const placed = await page.eval(`
    return { mark: window.__queens.state.marks[0], order: window.__queens.state.order };`);
  ok(placed.mark === 'queen', `enter left square 0 as "${placed.mark}"`);
  ok(placed.order.join() === '0', `the keyboard queen was not recorded (order ${placed.order})`);
  const said = await announcement(page);
  ok(said.includes('row 1, column 1'), `a queen placed by key announced "${said}"`);
  await press(' ');
  ok(await page.eval("return window.__queens.state.marks[0]") === 'empty',
     'the third press did not clear the square');
  ok(await page.eval('return window.__queens.state.order.length') === 0,
     'a queen taken back by key is still in the order');

  // X is the shortcut for the move you make most: cross off, and un-cross.
  // Both halves read in one go, so neither can pass on a square X never touched.
  await press('ArrowRight');
  const crossing = await page.eval(`
    const q = window.__queens;
    const key = k => document.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('x'); const on = q.state.marks[1];
    key('x'); const off = q.state.marks[1];
    return { on, off };`);
  ok(crossing.on === 'blocked', `X left the square under the cursor "${crossing.on}"`);
  ok(crossing.on === 'blocked' && crossing.off === 'empty',
     `X could not take its own cross back ("${crossing.on}" then "${crossing.off}")`);
  const uncrossed = await announcement(page);
  ok(/cross removed/i.test(uncrossed) && uncrossed.includes('Row 1, column 2'),
     `taking a cross back by key announced "${uncrossed}"`);

  // The cursor is drawn, and it is drawn where the state says it is.
  const drawn = await page.eval(`
    const rects = [...document.querySelectorAll('#board rect[data-cursor]')];
    return {
      count: rects.length,
      hidden: rects.filter(r => Number(r.getAttribute('opacity')) === 0).length,
      x: rects.map(r => Number(r.getAttribute('x'))),
      y: rects.map(r => Number(r.getAttribute('y'))),
      fills: document.querySelector('#board > g').children.length
    };`);
  ok(drawn.count > 0, 'the keyboard cursor is nowhere on the board');
  ok(drawn.hidden === 0, `${drawn.hidden} of the cursor's parts are invisible while it is in use`);
  ok(drawn.x.every(x => x > 0) && drawn.y.every(y => y === drawn.y[0]),
     `the cursor is drawn at ${drawn.x}, ${drawn.y} and the cursor is on row 1, column 2`);
  // The fills group is one rect per cell; the cursor must not have joined it.
  ok(drawn.fills === n * n, `the cursor changed the fills group to ${drawn.fills} rects`);
  if (shotDir) await page.screenshot(`${shotDir}/queens-cursor.png`);

  // A whole board, keys only: the point is not that a key moves something but
  // that the game can be finished this way.
  const byKeyboard = await page.eval(`
    const q = window.__queens, p = q.state.puzzle, n = p.n;
    q.restart();
    const key = k => document.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    key('ArrowUp'); key('ArrowLeft');            // park it at row 1, column 1
    for (let row = 0; row < n; row++) {
      const col = p.solution[row];
      // Bounded rather than "until it arrives": a board that answers no key at
      // all must fail this section, not hang it.
      for (let i = 0; i < n && (q.state.cursor % n) !== col; i++) {
        key((q.state.cursor % n) < col ? 'ArrowRight' : 'ArrowLeft');
      }
      key(' '); key(' ');                        // empty -> crossed off -> queen
      if (row + 1 < n) key('ArrowDown');
    }
    return { solved: q.state.solved, queens: q.state.marks.filter(m => m === 'queen').length };`);
  ok(byKeyboard.queens === n,
     `${byKeyboard.queens} of ${n} queens went down from the keyboard`);
  ok(byKeyboard.solved === true, 'a board solved entirely by keyboard was not recognised');

  // --- and it does not take the keys off a focused control ---------------------
  /*
   * The shell's guard, which Zip respects and Queens now does too. Claiming the
   * arrows unconditionally would take them off whatever the player has tabbed
   * to -- and space off every button on the page.
   */
  await page.eval('window.__queens.restart(); return 1');
  await press('ArrowDown');
  const parked = await cursor();
  await page.eval("document.getElementById('hintBtn').focus(); return 1");
  await press('ArrowRight', 'ArrowDown', ' ', 'x');
  ok(await cursor() === parked,
     `keys aimed at a focused button moved the board cursor from ${parked} to ${await cursor()}`);
  ok(await page.eval('return window.__queens.state.marks.every(m => m === "empty")'),
     'a space press meant for a focused button marked the board');

  // Focused, the board is the thing that owns them.
  await page.eval("document.querySelector('.board-region').focus(); return 1");
  await press('ArrowRight');
  ok(await cursor() === parked + 1,
     `with the board focused the cursor did not move (${parked} -> ${await cursor()})`);

  // --- and nothing types on a board the gate is still holding back ------------
  /*
   * The cursor reads out the square it lands on, region included. Before the
   * reveal that would be describing a board the player has not been shown.
   */
  await page.eval("window.__queens.load(window.__queens.generate('medium', 99)); return 1");
  await settle(page);
  ok(await page.eval("return window.__queens.state.phase") === 'ready',
     'the new board did not go back behind the gate');
  await page.eval("document.getElementById('announcer').textContent = ''; return 1");
  await press('ArrowRight', 'ArrowDown', ' ', 'x');
  ok(await cursor() === -1, `arrow keys put a cursor on a covered board (${await cursor()})`);
  ok(await page.eval('return window.__queens.state.marks.every(m => m === "empty")'),
     'the board took marks before it was revealed');
  ok(await announcement(page) === '',
     `a covered board read itself out: "${await announcement(page)}"`);
  const gated = await page.eval(`
    return [...document.querySelectorAll('#board rect[data-cursor]')]
      .every(r => Number(r.getAttribute('opacity')) === 0);`);
  ok(gated, 'the cursor is drawn on a board that has not been revealed');
  ok(page.consoleErrors.length === 0, `keyboard errors: ${page.consoleErrors.join(' | ')}`);

  // --- the board describes the game you are actually playing -------------------
  section('the board describes the game you are actually playing');
  /*
   * One board frame serves both games, and its accessible description was
   * Zip's, hardcoded: a Queens player was told to draw a line through every
   * square, take the numbers in order and not cross a wall -- the rules of a
   * different game, and the only instructions a screen reader gets here. The
   * progress bar called itself "Squares filled" while counting queens.
   */
  const queensHelp = await page.eval(`
    const region = document.querySelector('.board-region');
    return {
      describedby: region.getAttribute('aria-describedby'),
      help: document.getElementById('boardHelp').textContent.trim(),
      bar: document.querySelector('.progress').getAttribute('aria-label')
    };`);
  ok(queensHelp.describedby === 'boardHelp' && queensHelp.help.length > 0,
     'the Queens board has no described instructions');
  ok(/queen/i.test(queensHelp.help),
     `the Queens board description never mentions a queen: "${queensHelp.help}"`);
  ok(!/\bline\b|\bwall\b|number 1/i.test(queensHelp.help),
     `the Queens board is described in Zip's rules: "${queensHelp.help}"`);
  // The description must name keys this game actually has, not keys in general.
  ok(/arrow keys/i.test(queensHelp.help) && /\bX\b/.test(queensHelp.help),
     `the description does not name the keys Queens has: "${queensHelp.help}"`);
  ok(queensHelp.bar === 'queens settled',
     `the Queens progress bar calls itself "${queensHelp.bar}"`);

  // And Zip still gets Zip's, from the same route rather than by luck.
  await page.eval("location.hash = '#/zip'; return 1");
  for (let i = 0; i < 100; i++) {
    if (await page.eval('return !!window.__zip')) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(300);
  }
  await settle(page);
  const zipHelp = await page.eval(`
    return {
      help: document.getElementById('boardHelp').textContent.trim(),
      bar: document.querySelector('.progress').getAttribute('aria-label')
    };`);
  ok(/line/i.test(zipHelp.help) && !/queen/i.test(zipHelp.help),
     `Zip's board is no longer described in Zip's rules: "${zipHelp.help}"`);
  ok(zipHelp.bar === 'squares filled', `the Zip progress bar calls itself "${zipHelp.bar}"`);
  ok(page.consoleErrors.length === 0, `description errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

console.log(failures === 0
  ? `queens-feel  ${checks} browser assertions, 0 failures`
  : `queens-feel  ${checks} browser assertions, ${failures} failures`);

} finally {
  await site.close();
}
process.exit(failures === 0 ? 0 : 1);
