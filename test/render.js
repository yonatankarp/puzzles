/*
 * The only UI suite: real headless Chrome driving the built app.
 *
 * The app is React now, so the hand-rolled DOM stub that used to cover input
 * and rendering is gone -- its coverage lives here instead, driven by genuine
 * mouse and key events against the same bundle that gets deployed. dist/ is
 * served over HTTP because ES modules cannot load from file://.
 *
 * Usage: node test/render.js [--shots <dir>]
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('render  skipped — no Chrome found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

const TIERS = ['easy', 'medium', 'hard', 'expert'];
let checks = 0;
let failures = 0;
const started = Date.now();
let sectionChecks = 0;
const section = name => {
  const secs = ((Date.now() - started) / 1000).toFixed(0).padStart(3);
  writeSync(1, `  ${secs}s  ${name}\n`);
  sectionChecks = checks;
};

const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/*
 * Aim points inside a cell, as fractions of the cell box. The corner aims are
 * what make the hit-test meaningful: it must be exact to the cell boundary.
 * Ignoring the board's viewBox padding shifts boundaries by up to 6% of a cell,
 * so aiming 2% inside an edge catches it while the centre does not.
 */
const AIMS = {
  centre: [0.5, 0.5],
  topleft: [0.02, 0.02],
  bottomright: [0.98, 0.98]
};

// Client-pixel positions of every solution cell, computed in the page from the
// live board rect, so this exercises the real layout rather than a model of it.
const pointsFor = (ax, ay) => `
  const z = window.__zip, p = z.state.puzzle;
  const r = document.getElementById('board').getBoundingClientRect();
  const s = r.width / (p.cols * z.U + 2 * z.PAD);
  return p.solution.map(c => ({
    x: r.left + ((c % p.cols) * z.U + ${ax} * z.U + z.PAD) * s,
    y: r.top + (((c / p.cols) | 0) * z.U + ${ay} * z.U + z.PAD) * s
  }));`;

const POINTS = pointsFor(0.5, 0.5);

// Behaviour is driven against dist-test, which differs from the deployed dist
// only by the ?test hook flag. dist is served separately below and asserted to
// carry no hook at all.
const site = await serve('dist-test');
// Games live behind a fragment now; the bare address is the collection index.
const INDEX = `${site.origin}/index.html?test`;
const URL = `${INDEX}#/zip`;

/*
 * Wait for a usable board. Boards arrive covered with the clock stopped, and
 * most suites are about play rather than about the gate, so this uncovers by
 * default -- pass { reveal: false } to exercise the count-in itself.
 */
const ready = async (page, { reveal = true } = {}) => {
  await page.eval('return !!window.__zip');    // React has mounted and attached
  // Generation runs in a worker, so the board arrives a beat after the hooks.
  let arrived = false;
  for (let i = 0; i < 100; i++) {
    if (await page.eval('return !!window.__zip.state.puzzle')) { arrived = true; break; }
    await sleep(50);
  }
  if (!arrived) throw new Error('no puzzle after 5s');
  /*
   * A game shows its rules unasked the first time it is opened, and every test
   * runs in a fresh profile — so without this the sheet would sit over the
   * board in every suite. Dismissing it also marks it seen.
   */
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(200);
  }
  if (reveal) {
    await page.eval('window.__zip.reveal(); return 1');
    // The reveal publishes on the next animation frame, and until React has
    // re-rendered the board still carries pointer-events: none. Dragging before
    // that lands on nothing.
    await page.eval('return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
  }
  return page;
};

/*
 * Boards now start covered, with the clock beginning on reveal. Most suites are
 * about play rather than about the gate, so they skip the count-in; pass
 * { gate: true } to exercise it.
 */
const open = async (opts = {}) => {
  const page = await launch(opts.launch ?? {});
  await page.setup({ scheme: 'dark', width: 520, height: 900, ...opts });
  await page.goto(URL);
  return ready(page, { reveal: !opts.gate });
};

/*
 * The chrome is React, and the core publishes a snapshot at most once per
 * animation frame -- that coalescing is what keeps re-renders off the drag
 * path. So a DOM read straight after an action can legitimately see the
 * previous frame; wait two frames before asserting on rendered chrome.
 */
const settle = page =>
  page.eval('return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');

const loadPuzzle = async (page, tier, seed) => {
  // Most suites are about play, not about which mode supplied the board, so
  // they run in practice mode and hand the core a puzzle directly.
  await page.eval(`window.__zip.setMode('practice'); return 1`);
  await page.eval(`window.__zip.load(window.__zip.generate('${tier}', ${seed})); return 1`);
  await page.eval('window.__zip.reveal(); return 1');   // a fresh board is covered
  await settle(page);
};

/*
 * Capture what the app hands to the clipboard rather than using a real one:
 * clipboard access needs a focused document and granted permissions, neither of
 * which a headless tab reliably has. Whether Chrome's clipboard works is not
 * what these tests are about -- which path share() takes, and with what text, is.
 */
const stubClipboard = page => page.eval(`
  window.__copied = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async text => { window.__copied = text; } }
  });
  return 1;`);

const filled = async page => {
  await settle(page);
  return page.eval("return Number(document.getElementById('filled').textContent)");
};

const click = async (page, id) => {
  await page.eval(`document.getElementById('${id}').click(); return 1`);
  await settle(page);
};

try {

// --- renders in both colour schemes, no console errors ----------------------
section('renders in both colour schemes, no console errors');
let darkBg = null;
for (const scheme of ['dark', 'light']) {
  const page = await open({ scheme });
  ok(page.consoleErrors.length === 0, `${scheme}: console errors: ${page.consoleErrors.join(' | ')}`);

  const shape = await page.eval(`
    const b = document.getElementById('board');
    return {
      rules: b.querySelectorAll('line').length,
      numbers: b.querySelectorAll('text').length,
      trail: !!b.querySelector('polyline'),
      boardWidth: b.getBoundingClientRect().width,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bg: getComputedStyle(document.body).backgroundColor
    };`);
  ok(shape.trail, `${scheme}: no path element rendered`);
  ok(shape.numbers >= 4, `${scheme}: only ${shape.numbers} numbers drawn`);
  ok(shape.boardWidth > 200, `${scheme}: board is ${shape.boardWidth}px wide`);
  ok(shape.scrollW <= shape.clientW + 1, `${scheme}: page scrolls horizontally`);
  ok(/rgb/.test(shape.bg), `${scheme}: body has no resolved background`);
  if (scheme === 'dark') darkBg = shape.bg;
  else ok(shape.bg !== darkBg, 'light and dark render the same background');

  if (shotDir) {
    await loadPuzzle(page, 'medium', 31337);
    await page.eval('const z = window.__zip, s = z.state.puzzle.solution; for (let i = 0; i < 20; i++) z.step(s[i]); return 1');
    await sleep(140);
    await page.screenshot(`${shotDir}/zip-${scheme}.png`);
  }
  await page.close();
}

// --- the two routes to a light palette must agree ---------------------------
section('the two routes to a light palette must agree');
// The light tokens are declared twice: once under prefers-color-scheme for
// system-light viewers, once under [data-theme="light"] for the pin button. If
// those lists drift, the same user gets two different palettes.
{
  const page = await open({ scheme: 'light' });
  const TOKENS = ['--bg', '--panel', '--board', '--line', '--track', '--ink', '--dim',
                  '--accent', '--accent-ink', '--ring', '--path', '--path-ink', '--path-btn',
                  '--wall', '--good', '--bad', '--shadow', '--count-shadow'];
  const read = `
    const cs = getComputedStyle(document.documentElement);
    return ${JSON.stringify(TOKENS)}.map(t => t + '=' + cs.getPropertyValue(t).trim());`;
  const viaMedia = await page.eval(read);
  const viaPin = await page.eval(`document.documentElement.setAttribute('data-theme','light'); ` + read);
  TOKENS.forEach((token, i) => {
    ok(viaMedia[i] === viaPin[i],
       `light palette differs by route: system "${viaMedia[i]}" vs pinned "${viaPin[i]}"`);
    ok(viaMedia[i].split('=')[1] !== '', `${token} is empty under system light`);
  });
  await page.close();
}

// --- layout holds across the width range ------------------------------------
section('layout holds across the width range');
{
  const page = await open();
  for (const width of [320, 360, 375, 390, 414, 430, 520, 768, 1024]) {
    await page.send('Emulation.setDeviceMetricsOverride',
      { width, height: 900, deviceScaleFactor: 2, mobile: width < 500 });
    await sleep(90);
    const m = await page.eval(`
      const d = document.documentElement, b = document.getElementById('board');
      return {
        scrollW: d.scrollWidth, clientW: d.clientWidth,
        board: b.getBoundingClientRect().width,
        hint: getComputedStyle(document.querySelector('.hint')).display,
        title: getComputedStyle(document.querySelector('.brand-title')).display,
        titleText: document.querySelector('.brand-title').textContent.trim(),
        button: document.getElementById('newBtn').getBoundingClientRect().width
      };`);
    ok(m.scrollW <= m.clientW + 1, `${width}px: page scrolls horizontally (${m.scrollW} > ${m.clientW})`);
    ok(m.board > 120, `${width}px: board collapsed to ${Math.round(m.board)}px`);
    ok(m.button > 40, `${width}px: buttons collapsed to ${Math.round(m.button)}px`);
    /*
     * The hint line used to be dropped below 380px, together with the wordmark.
     * For Queens that line is the only standing statement of the controls
     * outside the rules sheet, so the narrowest phones lost the controls and
     * the title in the same breakpoint. Both now shrink instead of vanishing.
     */
    ok(m.hint !== 'none', `${width}px: the control hint is hidden`);
    ok(m.title !== 'none' && m.titleText.length > 0,
       `${width}px: the wordmark is hidden (display ${m.title}, text "${m.titleText}")`);
  }
  await page.close();
}

// --- every tier solves by real dragging, aimed at centres and at corners -----
section('every tier solves by real dragging, aimed at centres and at corners');
for (const tier of TIERS) {
  for (const [name, [ax, ay]] of Object.entries(AIMS)) {
    const page = await open();
    await loadPuzzle(page, tier, 900000);
    const pts = await page.eval(pointsFor(ax, ay));
    const total = await page.eval("return Number(document.getElementById('total').textContent)");
    ok(pts.length === total, `${tier}/${name}: ${pts.length} solution cells vs ${total} on the board`);

    await page.drag(pts);
    await sleep(150);
    const after = await page.eval(`return {
      filled: Number(document.getElementById('filled').textContent),
      banner: document.getElementById('banner').className,
      text: document.getElementById('bannerText').textContent,
      clock: document.getElementById('clock').className,
      progress: document.getElementById('progressFill').style.width
    };`);
    ok(after.filled === total, `${tier}/${name}: drag filled ${after.filled} of ${total}`);
    ok(/show/.test(after.banner), `${tier}/${name}: no win banner`);
    ok(/\d:\d\d\.\d/.test(after.text), `${tier}/${name}: win banner has no time: "${after.text}"`);
    ok(/done/.test(after.clock), `${tier}/${name}: clock did not stop`);
    ok(after.progress === '100%', `${tier}/${name}: progress bar at ${after.progress}`);
    ok(page.consoleErrors.length === 0, `${tier}/${name}: ${page.consoleErrors.join(' | ')}`);

    // Undo, restart and reveal must each do exactly their one thing.
    await click(page, 'undoBtn');
    ok(await filled(page) === total - 1, `${tier}/${name}: undo did not retract one cell`);
    await click(page, 'restartBtn');
    ok(await filled(page) === 0, `${tier}/${name}: restart did not clear the board`);
    await click(page, 'revealBtn');
    ok(await filled(page) === total, `${tier}/${name}: reveal did not show the solution`);
    await page.close();
  }
}

// --- keyboard play ----------------------------------------------------------
section('keyboard play');
{
  const page = await open();
  await loadPuzzle(page, 'easy', 4242);
  const total = await page.eval("return Number(document.getElementById('total').textContent)");
  const keys = await page.eval(`
    const s = window.__zip.state.puzzle, sol = s.solution, out = ['ArrowRight'];
    for (let i = 1; i < sol.length; i++) {
      const d = sol[i] - sol[i - 1];
      out.push(d === 1 ? 'ArrowRight' : d === -1 ? 'ArrowLeft' : d === s.cols ? 'ArrowDown' : 'ArrowUp');
    }
    return out;`);
  for (const key of keys) {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key });
  }
  await settle(page);
  ok(await filled(page) === total, `keyboard play filled ${await filled(page)} of ${total}`);
  ok(/show/.test(await page.eval("return document.getElementById('banner').className")),
     'keyboard solve did not win');
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'u', code: 'KeyU', windowsVirtualKeyCode: 85 });
  ok(await filled(page) === total - 1, 'U did not undo');
  await page.close();
}

// --- filling every cell but ending elsewhere is refused, and says why --------
section('filling every cell but ending elsewhere is refused, and says why');
{
  let fired = false;
  for (let seed = 0; seed < 400 && !fired; seed++) {
    const page = await open();
    await loadPuzzle(page, 'easy', 700000 + seed);
    // Search, using only the game's own legality rule, for a full cover that
    // does not end on the last number -- the state the error banner is for.
    const bad = await page.eval(`
      const z = window.__zip, st = z.state, eng = st.engine, n = st.puzzle.rows * st.puzzle.cols;
      const inPath = new Uint8Array(n), p = [];
      let found = null;
      (function dfs() {
        if (found) return;
        if (p.length === n) { if (!eng.validate(p)) found = p.slice(); return; }
        for (let c = 0; c < n; c++) {
          if (!eng.canStep(p, inPath, c)) continue;
          p.push(c); inPath[c] = 1;
          dfs();
          inPath[p.pop()] = 0;
          if (found) return;
        }
      })();
      return found;`);
    if (!bad) { await page.close(); continue; }

    await page.eval(`const z = window.__zip; z.restart(); ${JSON.stringify(bad)}.forEach(c => z.step(c)); return 1`);
    await settle(page);
    const total = await page.eval("return Number(document.getElementById('total').textContent)");
    ok(await filled(page) === total, 'wrong-ending case did not fill the grid');
    ok(/must end on the last number/.test(await page.eval("return document.getElementById('bannerText').textContent")),
       'wrong-ending banner did not fire');
    ok(await page.eval("return localStorage.getItem('zip.best.medium') === null"),
       'a wrong solve recorded a best time');
    fired = true;
    await page.close();
  }
  ok(fired, 'could not construct a filled-but-wrong path to test the error branch');
}

// --- the line must follow the pointer, not jump a cell at a time -------------
section('the line must follow the pointer, not jump a cell at a time');
{
  const page = await open();
  await loadPuzzle(page, 'easy', 5150);
  const pts = await page.eval(POINTS);
  const TIP = `
    const s = document.querySelector('#board polyline').getAttribute('points').trim().split(' ');
    const last = s[s.length - 1].split(',');
    return { x: parseFloat(last[0]), y: parseFloat(last[1]) };`;

  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  const seen = [];
  const STEPS = 12;
  for (let i = 0; i <= STEPS; i++) {
    await page.mouse('mouseMoved',
      pts[0].x + (pts[1].x - pts[0].x) * i / STEPS,
      pts[0].y + (pts[1].y - pts[0].y) * i / STEPS);
    seen.push(await page.eval(TIP));
  }
  await page.mouse('mouseReleased', pts[1].x, pts[1].y);

  const distinct = new Set(seen.map(s => `${s.x.toFixed(2)},${s.y.toFixed(2)}`)).size;
  let biggest = 0;
  for (let i = 1; i < seen.length; i++) {
    biggest = Math.max(biggest, Math.hypot(seen[i].x - seen[i - 1].x, seen[i].y - seen[i - 1].y));
  }
  // Cell centres are 100 viewBox units apart; a cell-at-a-time line gives 2
  // distinct positions and a 100-unit jump.
  ok(distinct >= 9, `line took only ${distinct} distinct positions crossing one cell (jumpy)`);
  ok(biggest < 25, `line jumped ${biggest.toFixed(1)} viewBox units in one pointer move`);
  await page.close();
}

// --- a fast flick along a straight run must not skip cells -------------------
section('a fast flick along a straight run must not skip cells');
{
  const page = await open();
  await loadPuzzle(page, 'medium', 2468);
  const pts = await page.eval(POINTS);
  const run = await page.eval(`
    const sol = window.__zip.state.puzzle.solution;
    let best = { start: 0, end: 0 }, start = 0;
    for (let i = 1; i < sol.length; i++) {
      const straight = i >= 2 && (sol[i] - sol[i - 1]) === (sol[i - 1] - sol[i - 2]);
      if (!straight) start = i - 1;
      if (i - start > best.end - best.start) best = { start, end: i };
    }
    return best;`);
  ok(run.end - run.start >= 2, `no straight run found (got ${run.end - run.start})`);

  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  for (let k = 1; k <= run.start; k++) await page.mouse('mouseMoved', pts[k].x, pts[k].y);
  const before = await filled(page);
  await page.mouse('mouseMoved', pts[run.end].x, pts[run.end].y);   // one single event
  const after = await filled(page);
  await page.mouse('mouseReleased', pts[run.end].x, pts[run.end].y);
  ok(before === run.start + 1, `setup drag reached ${before}, expected ${run.start + 1}`);
  ok(after === run.end + 1, `flick across ${run.end - run.start} cells committed ${after - before}`);
  await page.close();
}

// --- the line must not be erasable by a stray movement ----------------------
section('the line must not be erasable by a stray movement');
{
  const page = await open();
  await loadPuzzle(page, 'medium', 3141);
  const pts = await page.eval(POINTS);
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
  ok(await filled(page) === 9, `setup drew ${await filled(page)} cells, expected 9`);

  for (const back of [0, 2, 4]) {
    await page.eval(`window.__zip.step(window.__zip.state.path[${back}]); return 1`);
    ok(await filled(page) === 9, `touching drawn cell #${back} truncated the line`);
  }
  // Retracing, though, must still work: back over the previous cell pops one.
  await page.mouse('mouseMoved', pts[7].x, pts[7].y);
  ok(await filled(page) === 8, 'retracing one cell did not pop one');
  await page.mouse('mouseMoved', pts[6].x, pts[6].y);
  await page.mouse('mouseMoved', pts[5].x, pts[5].y);
  ok(await filled(page) === 6, 'retracing three cells did not pop three');
  await page.mouse('mouseReleased', pts[5].x, pts[5].y);
  await page.close();
}

// --- hints: next move, direction, and rescuing a lost board -----------------
section('hints: next move, direction, and rescuing a lost board');
{
  const page = await open();
  await loadPuzzle(page, 'medium', 606);

  const readHint = `
    const g = document.querySelector('#board g[data-hint]');
    if (!g) return null;
    const arrow = g.querySelector('path'), rect = g.querySelector('rect');
    // Parsed by hand: a regex here would sit inside a template literal and lose
    // its backslashes before it ever reached the page.
    const rot = parseFloat(arrow.getAttribute('transform').split('rotate(')[1]);
    const p = window.__zip.state.puzzle;
    const col = Math.round((parseFloat(rect.getAttribute('x')) - 6) / 100);
    const row = Math.round((parseFloat(rect.getAttribute('y')) - 6) / 100);
    return { rotate: rot, target: row * p.cols + col };`;
  const expected = at => `
    const p = window.__zip.state.puzzle, sol = p.solution;
    const from = sol[${at} - 1], to = sol[${at}];
    const dx = (to % p.cols) - (from % p.cols), dy = ((to / p.cols) | 0) - ((from / p.cols) | 0);
    return { target: to, rotate: dx === 1 ? 0 : dx === -1 ? 180 : dy === 1 ? 90 : 270 };`;

  // On an untouched board the hint is the opening move.
  await page.eval('window.__zip.hint(); return 1');
  let hint = await page.eval(readHint);
  let want = await page.eval(expected(1));
  ok(hint !== null, 'no hint drawn on an empty board');
  ok(hint?.target === want.target, `opening hint points at ${hint?.target}, expected ${want.target}`);
  ok(hint?.rotate === want.rotate, `opening arrow rotated ${hint?.rotate}, expected ${want.rotate}`);

  // Part-way along the real solution, it points at the next cell.
  await page.eval('const z = window.__zip, s = z.state.puzzle.solution; for (let i = 0; i < 5; i++) z.step(s[i]); return 1');
  ok(await page.eval("return !document.querySelector('#board g[data-hint]')"),
     'hint did not clear when the player moved');
  await page.eval('window.__zip.hint(); return 1');
  hint = await page.eval(readHint);
  want = await page.eval(expected(5));
  ok(hint?.target === want.target, `hint points at ${hint?.target}, expected ${want.target}`);
  ok(hint?.rotate === want.rotate, `arrow rotated ${hint?.rotate}, expected ${want.rotate}`);

  // Step somewhere legal but wrong: the board is now unfinishable, so the hint
  // must reset it and show the opening move again. Not every square offers a
  // wrong-but-legal move -- walls often leave one continuation -- so search.
  const diverged = await page.eval(`
    const z = window.__zip;
    const sol = z.state.puzzle.solution, eng = z.state.engine;
    z.restart();
    z.step(sol[0]);
    for (let i = 1; i < sol.length; i++) {
      const path = z.state.path, inPath = z.state.inPath;   // re-read: restart replaced them
      const head = path[path.length - 1];
      for (const c of eng.adj[head]) {
        if (c !== sol[i] && eng.canStep(path, inPath, c)) { z.step(c); return i; }
      }
      z.step(sol[i]);
    }
    return -1;`);
  ok(diverged >= 0, 'could not construct an off-track path anywhere in the solution');
  ok(await filled(page) > 1, 'off-track setup drew nothing');

  await page.eval('window.__zip.hint(); return 1');
  ok(await filled(page) === 0, 'an off-track board was not reset');
  ok(/Off track/i.test(await page.eval("return document.getElementById('bannerText').textContent")),
     'no explanation given when the board was reset');
  hint = await page.eval(readHint);
  want = await page.eval(expected(1));
  ok(hint?.target === want.target, 'hint after a reset does not show the opening move');

  await sleep(2900);
  ok(await page.eval("return !document.querySelector('#board g[data-hint]')"), 'hint never faded');
  ok(page.consoleErrors.length === 0, `hint errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a hinted solve never sets a record -------------------------------------
section('a hinted solve never sets a record');
{
  const page = await open();
  await page.eval("localStorage.setItem('zip.best.medium', '999999'); return 1");
  await loadPuzzle(page, 'medium', 707);
  await page.eval('window.__zip.hint(); return 1');
  await page.drag(await page.eval(POINTS));
  await sleep(200);
  const out = await page.eval(`return {
    best: localStorage.getItem('zip.best.medium'),
    sub: document.getElementById('bannerText').textContent
  };`);
  ok(out.best === '999999', `a hinted solve overwrote the best time (now ${out.best})`);
  ok(/hint/i.test(out.sub), `banner did not mention the hint: "${out.sub}"`);
  await page.close();
}

// --- audio: silent by default, and genuinely running once asked for ---------
section('audio: silent by default, and genuinely running once asked for');
{
  // No relaxing autoplay flag here: the browser's own policy must be satisfied.
  const page = await open({ launch: { autoplay: 'default' } });
  await loadPuzzle(page, 'easy', 8080);
  let pts = await page.eval(POINTS);

  ok(await page.eval("return window.__zip.audio.mode === 'off'"), 'sound does not default to off');
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  await page.mouse('mouseMoved', pts[1].x, pts[1].y);
  await page.mouse('mouseReleased', pts[1].x, pts[1].y);
  ok(await page.eval('return window.__zip.audio.context === null'),
     'an AudioContext was built while sound was off');

  // Turned on, a real gesture must leave the context running -- a suspended one
  // is the classic way audio silently does nothing.
  await page.eval("localStorage.setItem('app.sound','all'); return 1");
  await page.reload();
  await ready(page);
  await loadPuzzle(page, 'easy', 8080);
  pts = await page.eval(POINTS);
  ok(await page.eval("return window.__zip.audio.mode === 'all'"), 'stored sound mode not restored');
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  await page.mouse('mouseMoved', pts[1].x, pts[1].y);
  ok(await page.eval('return !!window.__zip.audio.context'), 'no AudioContext after a real gesture');
  ok(await page.eval("return window.__zip.audio.context.state === 'running'"),
     'AudioContext is suspended, so nothing would be heard');
  await page.mouse('mouseReleased', pts[1].x, pts[1].y);

  // The speaker cycles all -> sparse -> off -> all, persisting each step, and
  // the icon shows which of the three you are in.
  const cycle = [
    ['sparse', { near: '', far: 'none', mute: 'none' }, 'true'],
    ['off', { near: 'none', far: 'none', mute: '' }, 'false'],
    ['all', { near: '', far: '', mute: 'none' }, 'true']
  ];
  for (const [mode, icon, pressed] of cycle) {
    await click(page, 'soundBtn');
    ok(await page.eval(`return localStorage.getItem('app.sound') === '${mode}'`),
       `sound mode did not persist as ${mode}`);
    ok(await page.eval(`return window.__zip.audio.mode === '${mode}'`), `mode is not ${mode}`);
    const shown = await page.eval(`return {
      near: document.getElementById('soundWave').style.display,
      far: document.getElementById('soundWaveFar').style.display,
      mute: document.getElementById('soundMute').style.display,
      pressed: document.getElementById('soundBtn').getAttribute('aria-pressed')
    };`);
    ok(shown.near === icon.near && shown.far === icon.far && shown.mute === icon.mute,
       `${mode}: icon shows ${JSON.stringify(shown)}, expected ${JSON.stringify(icon)}`);
    ok(shown.pressed === pressed, `${mode}: aria-pressed is ${shown.pressed}`);
  }
  await page.close();
}

// --- every solve celebrates, and a personal best celebrates harder ----------
section('every solve celebrates, and a personal best celebrates harder');
const burst = async priorBest => {
  const page = await open();
  if (priorBest) await page.eval(`localStorage.setItem('zip.best.medium','${priorBest}'); return 1`);
  await loadPuzzle(page, 'medium', 1212);
  await page.drag(await page.eval(POINTS));
  await sleep(700);                             // long enough for every wave
  const peak = await page.eval("return document.querySelectorAll('.fx > *').length");
  const moved = await page.eval(`
    const first = document.querySelector('.fx > *');
    const t = first && first.getAttribute('transform');
    return !!t && t.indexOf('translate') === 0;`);
  const popped = await page.eval("return document.getElementById('board').classList.contains('won')");
  await sleep(1800);
  const after = await page.eval("return document.querySelectorAll('.fx > *').length");
  await page.close();
  return { peak, moved, popped, after };
};
{
  // An "ordinary" solve needs an unbeatable record on file -- with nothing
  // stored, the first solve is itself a personal best.
  const plain = await burst(1);
  ok(plain.peak > 50, `an ordinary solve threw only ${plain.peak} pieces`);
  ok(plain.moved, 'burst pieces are not being moved');
  ok(plain.popped, 'the board did not pop on the win');
  ok(plain.after === 0, `burst never cleaned up (${plain.after} pieces left)`);

  const best = await burst(999999);
  ok(best.peak > plain.peak * 1.6,
     `a personal best threw ${best.peak} pieces vs ${plain.peak} for an ordinary solve`);
  ok(best.after === 0, 'personal-best burst never cleaned up');
}

// --- reduced motion drops the decoration, keeps the game --------------------
section('reduced motion drops the decoration, keeps the game');
{
  const page = await open({ reducedMotion: true });
  await page.eval("localStorage.setItem('zip.best.medium','999999'); return 1");
  await loadPuzzle(page, 'medium', 1212);
  const total = await page.eval("return Number(document.getElementById('total').textContent)");
  await page.drag(await page.eval(POINTS));
  await sleep(200);
  ok(await page.eval("return !document.querySelector('#board polyline[data-shine]')"),
     'win sweep ran despite prefers-reduced-motion');
  ok(await page.eval("return document.querySelectorAll('.fx > *').length === 0"),
     'burst ran despite prefers-reduced-motion');
  ok(await filled(page) === total, 'reduced motion broke the solve');
  ok(/show/.test(await page.eval("return document.getElementById('banner').className")),
     'reduced motion suppressed the win banner');
  await page.close();
}

// --- the clock belongs to the puzzle, not the attempt -----------------------
section('the clock belongs to the puzzle, not the attempt');
// Restarting must not reset or pause it, or a run going badly could simply be
// wiped to protect a best time.
{
  const page = await open();
  await loadPuzzle(page, 'medium', 2727);
  const pts = await page.eval(POINTS);
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  for (let i = 1; i <= 6; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
  await page.mouse('mouseReleased', pts[6].x, pts[6].y);
  await sleep(500);
  const running = await page.eval('return window.__zip.state.elapsed');
  ok(running > 300, `clock only reached ${Math.round(running)}ms before the restart`);

  await click(page, 'restartBtn');
  const kept = await page.eval('return window.__zip.state.elapsed');
  ok(await filled(page) === 0, 'restart left cells drawn');
  ok(kept >= running - 20, `restart reset the clock (${Math.round(running)} -> ${Math.round(kept)})`);

  await sleep(500);
  const later = await page.eval('return window.__zip.state.elapsed');
  ok(later > kept + 300, `clock stalled after the restart (${Math.round(kept)} -> ${Math.round(later)})`);

  // Finishing from here must bank the whole elapsed time, restart included.
  await page.drag(await page.eval(POINTS));
  await sleep(200);
  const banked = Number(await page.eval("return localStorage.getItem('zip.best.medium')"));
  ok(banked > later, `a restarted solve banked ${banked}ms, less than the ${Math.round(later)}ms spent`);

  // A new puzzle, though, does start a fresh clock.
  await click(page, 'newBtn');
  await sleep(120);
  ok(await page.eval('return window.__zip.state.elapsed') < 150, 'a new puzzle inherited time');
  ok(await page.eval('return window.__zip.state.running === false'),
     'a new puzzle started its clock before the first move');
  await page.close();
}

// --- the daily: same board for everyone, one result a day ------------------
section('the daily: same board for everyone, one result a day');
{
  // Deterministic: the same UTC day must produce byte-identical boards across
  // separate page loads, because the seed comes from the date and nothing else.
  const fingerprint = `
    const p = window.__zip.state.puzzle;
    return JSON.stringify({ w: p.walls, n: p.waypoints, s: p.solution });`;

  const first = await open();
  ok(await first.eval("return window.__zip.core.mode === 'daily'"), 'daily is not the default mode');
  const dayOne = await first.eval('return window.__zip.day');
  const boardOne = await first.eval(fingerprint);
  ok(/Daily #/.test(await first.eval("return document.getElementById('dayNumber').textContent")),
     'daily bar does not name the puzzle');
  ok(await first.eval("return document.getElementById('newBtn').disabled === true"),
     'New is clickable in daily mode, but there is only one puzzle a day');
  ok(await first.eval("return getComputedStyle(document.getElementById('newBtn')).opacity !== '1'"),
     'the disabled New button still looks enabled');
  ok(await first.eval("return !document.getElementById('autoBtn')"),
     'auto-next is offered in daily mode, where there is nothing to advance to');
  await first.close();

  const second = await open();
  ok(await second.eval('return window.__zip.day') === dayOne, 'day number is not stable');
  ok(await second.eval(fingerprint) === boardOne, 'the daily differs between loads');

  // A different day must give a different board.
  const other = await second.eval(`
    const z = window.__zip;
    const a = JSON.stringify(z.generate('medium', (${dayOne} * 2654435761) >>> 0).solution);
    const b = JSON.stringify(z.generate('medium', ((${dayOne} + 1) * 2654435761) >>> 0).solution);
    return a !== b;`);
  ok(other, 'consecutive days generate the same puzzle');
  await second.close();
}

// --- backtracks are counted and reported ------------------------------------
section('backtracks are counted and reported');
{
  const page = await open();
  await page.eval("window.__zip.setMode('practice'); return 1");
  await loadPuzzle(page, 'medium', 8675);
  const pts = await page.eval(POINTS);

  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  for (let i = 1; i <= 6; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
  await settle(page);
  ok(await page.eval("return !document.getElementById('backtracks')"),
     'a backtrack was counted before any retraction');

  for (const i of [5, 4, 3]) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
  await settle(page);
  ok(/↩ 3/.test(await page.eval("return document.getElementById('backtracks').textContent")),
     `retracing three cells reported ${await page.eval("return document.getElementById('backtracks').textContent")}`);

  // The Undo button counts too, and the win line reports the total.
  await click(page, 'undoBtn');
  ok(/↩ 4/.test(await page.eval("return document.getElementById('backtracks').textContent")),
     'the Undo button did not count as a backtrack');
  await page.mouse('mouseReleased', pts[3].x, pts[3].y);
  await page.drag(await page.eval(POINTS));
  await sleep(200);
  ok(/backtrack/.test(await page.eval("return document.getElementById('bannerText').textContent")),
     'the win line does not report backtracks');
  await page.close();
}

// --- solving the daily records it, and the result is shareable --------------
section('solving the daily records it, and the result is shareable');
{
  const page = await open();
  const day = await page.eval('return window.__zip.day');
  // Two prior days on record, so a streak exists to report.
  await page.eval(`
    for (const d of [${day - 2}, ${day - 1}]) {
      localStorage.setItem('zip.daily.' + d, JSON.stringify({ day: d, ms: 40000, backtracks: 1, hinted: false }));
    }
    return 1;`);
  await page.reload();
  await ready(page);
  await stubClipboard(page);
  // `delete` cannot remove a prototype property, so shadow it instead -- and a
  // real drag grants transient activation, which would otherwise let the native
  // share sheet succeed and legitimately skip the clipboard.
  await page.eval("Object.defineProperty(navigator,'share',{configurable:true,value:undefined}); return 1");
  await settle(page);
  ok(await page.eval("return !!document.getElementById('dailyTodo')"), 'today already shows as solved');
  // A streak stands until a day is missed, so it shows before today is played.
  ok(await page.eval("return /2 day streak/.test(document.getElementById('streak').textContent)"),
     'the standing streak is hidden until today is solved');

  await page.drag(await page.eval(POINTS));
  await sleep(300);
  const recorded = await page.eval(`return localStorage.getItem('zip.daily.' + window.__zip.day)`);
  ok(recorded !== null, 'solving the daily recorded nothing');
  const parsed = JSON.parse(recorded ?? '{}');
  ok(parsed.day === day, `recorded day ${parsed.day}, expected ${day}`);
  ok(typeof parsed.ms === 'number' && parsed.ms > 0, 'recorded no time');
  ok(/Daily #/.test(await page.eval("return document.getElementById('bannerText').textContent")),
     'the daily win line does not name the puzzle');
  ok(/3 day streak/.test(await page.eval("return document.getElementById('bannerText').textContent")),
     'the streak was not reported on the third consecutive day');

  await settle(page);
  ok(await page.eval("return /3 day streak/.test(document.getElementById('streak').textContent)"),
     'the daily bar does not show the streak');

  await click(page, 'shareBtn');
  await sleep(200);
  const clip = await page.eval('return window.__copied');
  ok(typeof clip === 'string' && /^Zip #\d+ — \d:\d\d\.\d/.test(clip), `share text was "${clip}"`);
  ok(/backtrack/.test(clip ?? ''), 'share text omits backtracks');
  ok((clip ?? '').includes(site.origin), 'share text omits the link');
  ok(/Copied/.test(await page.eval("return document.getElementById('shareBtn').textContent")),
     'the share button gave no feedback');

  // Replaying must not overwrite the day's recorded result.
  const before = recorded;
  await click(page, 'restartBtn');
  await page.drag(await page.eval(POINTS));
  await sleep(300);
  ok(await page.eval("return localStorage.getItem('zip.daily.' + window.__zip.day)") === before,
     'replaying the daily overwrote the recorded result');
  await page.close();
}

// --- practice mode still behaves ---------------------------------------------
section('practice mode still behaves');
{
  const page = await open();
  await page.eval("window.__zip.setMode('practice'); return 1");
  await settle(page);
  ok(await page.eval("return !!document.getElementById('tiers')"), 'practice mode has no tier picker');
  ok(await page.eval("return document.getElementById('newBtn').disabled === false"),
     'New is disabled in practice mode');
  ok(await page.eval("return !document.getElementById('dailyBar')"), 'the daily bar is showing in practice mode');
  await page.eval("window.__zip.setMode('daily'); return 1");
  await settle(page);
  ok(await page.eval("return !!document.getElementById('dailyBar')"), 'daily mode has no daily bar');
  ok(await page.eval("return !document.getElementById('tiers')"), 'the tier picker is showing in daily mode');
  await page.close();
}

// --- a superseded generation must not land on the board ---------------------
section('a superseded generation must not land on the board');
// Generation is deferred a frame, so two quick switches leave two in flight.
{
  const page = await open();
  await page.eval("window.__zip.setMode('practice'); return 1");
  await page.eval("window.__zip.load(window.__zip.generate('expert', 4242)); return 1");
  const claimed = await page.eval('return JSON.stringify(window.__zip.state.puzzle.waypoints)');
  await sleep(400);           // long enough for any in-flight generation to finish
  const now = await page.eval('return JSON.stringify(window.__zip.state.puzzle.waypoints)');
  ok(now === claimed, 'a superseded generation replaced the loaded puzzle');
  await page.close();
}

// --- a refresh must not reset the daily -------------------------------------
section('a refresh must not reset the daily');
// Restart deliberately keeps the clock; a reload used to hand out a clean board
// and a zero clock, which was the same reset by another route.
{
  const page = await open();
  const pts = await page.eval(POINTS);
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  for (let i = 1; i <= 7; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
  await page.mouse('mouseMoved', pts[6].x, pts[6].y);        // one backtrack
  await page.mouse('mouseReleased', pts[6].x, pts[6].y);
  await sleep(1200);                                          // past the save throttle
  const before = await page.eval(`return {
    filled: window.__zip.state.path.length,
    elapsed: window.__zip.state.elapsed,
    path: JSON.stringify(window.__zip.state.path)
  };`);
  ok(before.filled === 7, `setup drew ${before.filled} cells, expected 7`);
  ok(before.elapsed > 900, `clock only reached ${Math.round(before.elapsed)}ms`);

  await page.reload();
  await ready(page);
  await settle(page);
  const after = await page.eval(`return {
    filled: window.__zip.state.path.length,
    elapsed: window.__zip.state.elapsed,
    running: window.__zip.state.running,
    path: JSON.stringify(window.__zip.state.path),
    backtracksText: document.getElementById('backtracks')?.textContent ?? ''
  };`);
  ok(after.path === before.path, 'the drawn path was not restored after a reload');
  ok(after.elapsed >= before.elapsed - 50,
     `the clock reset on reload (${Math.round(before.elapsed)} -> ${Math.round(after.elapsed)})`);
  ok(after.running === true, 'the clock did not resume after a reload');
  ok(/↩\s*1\b/.test(after.backtracksText),
     `backtracks were not restored (status read "${after.backtracksText}")`);

  // A tampered or stale path must be discarded rather than trusted.
  await page.eval(`
    window.__zip.setMode('practice');                  // stops the save loop
    const saved = JSON.parse(localStorage.getItem('zip.progress'));
    saved.moves = [saved.moves[0], 999];               // not even on the grid
    localStorage.setItem('zip.progress', JSON.stringify(saved));
    localStorage.setItem('zip.mode', 'daily');         // ...but reload as daily
    return 1;`);
  await sleep(1200);                                   // outlive any pending save
  await page.reload();
  await ready(page);
  await settle(page);
  ok(await page.eval('return window.__zip.state.path.length') === 0,
     'an illegal saved path was replayed instead of discarded');

  // Finishing clears it, so tomorrow does not inherit today's run.
  await page.drag(await page.eval(POINTS));
  await sleep(300);
  ok(await page.eval("return localStorage.getItem('zip.progress') === null"),
     'progress was left behind after the daily was solved');
  await page.close();
}

// --- accessibility ----------------------------------------------------------
section('accessibility');
const parseRgb = text => (text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => {
  const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(parseRgb(a)), luminance(parseRgb(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

{
  const page = await open();

  // The <svg> mutates by hand and announces nothing on its own, so the
  // accessible interface is the region around it plus a live region.
  const shape = await page.eval(`
    const region = document.querySelector('.board-region');
    const live = document.getElementById('announcer');
    const bar = document.querySelector('.progress');
    return {
      role: region?.getAttribute('role'),
      tabindex: region?.getAttribute('tabindex'),
      label: region?.getAttribute('aria-label'),
      describedby: region?.getAttribute('aria-describedby'),
      helpText: document.getElementById('boardHelp')?.textContent?.trim().slice(0, 40),
      svgHidden: document.getElementById('board')?.getAttribute('aria-hidden'),
      liveSetting: live?.getAttribute('aria-live'),
      barRole: bar?.getAttribute('role'),
      barMax: bar?.getAttribute('aria-valuemax')
    };`);
  ok(shape.role === 'application', `board region role is "${shape.role}"`);
  ok(shape.tabindex === '0', 'the board cannot be reached by keyboard');
  ok(/\d+ of \d+ squares filled/.test(shape.label ?? ''),
     `board label does not carry state: "${shape.label}"`);
  ok(!!shape.describedby && !!shape.helpText, 'the board has no described instructions');
  ok(shape.svgHidden === 'true', 'the decorative svg is exposed to assistive tech');
  ok(shape.liveSetting === 'polite', `live region is "${shape.liveSetting}"`);
  ok(shape.barRole === 'progressbar' && shape.barMax === '36', 'progress bar is not exposed');

  // Moves must be spoken, or the line is invisible to a screen reader.
  const pts = await page.eval(POINTS);
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  await page.mouse('mouseMoved', pts[1].x, pts[1].y);
  await page.mouse('mouseReleased', pts[1].x, pts[1].y);
  await settle(page);
  const spoken = await page.eval("return document.getElementById('announcer').textContent");
  ok(/Row \d+, column \d+/.test(spoken), `nothing useful was announced: "${spoken}"`);
  const labelNow = await page.eval("return document.querySelector('.board-region').getAttribute('aria-label')");
  ok(/2 of 36 squares filled/.test(labelNow), `board label did not follow the move: "${labelNow}"`);
  await page.close();
}

// --- keyboard focus is visible, and the arrows are not stolen ---------------
section('keyboard focus is visible, and the arrows are not stolen');
{
  const page = await open();
  const tab = async () => {
    await page.send('Input.dispatchKeyEvent',
      { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  };
  let ringed = 0;
  let stops = 0;
  for (let i = 0; i < 8; i++) {
    await tab();
    const at = await page.eval(`
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { tag: el.tagName, outline: cs.outlineStyle, width: cs.outlineWidth };`);
    if (!at) continue;
    stops++;
    if (at.outline !== 'none' && parseFloat(at.width) > 0) ringed++;
  }
  ok(stops >= 4, `only ${stops} elements were reachable by Tab`);
  ok(ringed === stops, `${stops - ringed} of ${stops} focus stops showed no focus ring`);

  // With a button focused, the arrows belong to the page, not the board.
  await page.eval("document.getElementById('restartBtn').focus(); return 1");
  const before = await page.eval('return window.__zip.state.path.length');
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await settle(page);
  ok(await page.eval('return window.__zip.state.path.length') === before,
     'an arrow key drew on the board while a button had focus');

  // Focus the board and the same key works.
  await page.eval("document.querySelector('.board-region').focus(); return 1");
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await settle(page);
  ok(await page.eval('return window.__zip.state.path.length') > before,
     'arrow keys do nothing even with the board focused');
  await page.close();
}

// --- text contrast ----------------------------------------------------------
section('text contrast');
for (const scheme of ['dark', 'light']) {
  const page = await open({ scheme });
  const colours = await page.eval(`
    const cs = getComputedStyle(document.body);
    const dim = getComputedStyle(document.getElementById('tierStats'));
    const btn = getComputedStyle(document.getElementById('newBtn'));
    return {
      bg: cs.backgroundColor, ink: cs.color,
      dim: dim.color, dimBg: getComputedStyle(document.body).backgroundColor,
      btnFg: btn.color, btnBg: btn.backgroundColor
    };`);
  const ink = contrast(colours.ink, colours.bg);
  const dim = contrast(colours.dim, colours.dimBg);
  const btn = contrast(colours.btnFg, colours.btnBg);
  ok(ink >= 4.5, `${scheme}: body text contrast is ${ink.toFixed(2)}:1, below 4.5`);
  ok(dim >= 4.5, `${scheme}: secondary text contrast is ${dim.toFixed(2)}:1, below 4.5`);
  ok(btn >= 4.5, `${scheme}: primary button contrast is ${btn.toFixed(2)}:1, below 4.5`);
  await page.close();
}

// --- generation runs off the main thread ------------------------------------
section('generation runs off the main thread');
{
  const page = await open();
  ok(await page.eval('return window.__zip.core.source.usingWorker === true'),
     'puzzle generation is not using a worker');

  // The main thread must stay responsive while an Expert board is generated.
  await page.eval("window.__zip.setMode('practice'); return 1");
  const stall = await page.eval(`
    window.__zip.core.difficulty = 'expert';
    let frames = 0;
    const tick = () => { frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__zip.newPuzzle();
    await new Promise(r => setTimeout(r, 700));
    return frames;`);
  // 700ms of unblocked frames is ~40+; a blocking generate would swallow many.
  ok(stall > 25, `only ${stall} frames rendered while generating (main thread blocked)`);
  await page.close();
}

// --- the daily rolls over at UTC midnight -----------------------------------
section('the daily rolls over at UTC midnight');
{
  const page = await open();
  const before = await page.eval(`return {
    day: window.__zip.day,
    board: JSON.stringify(window.__zip.state.puzzle.waypoints)
  };`);

  // Mid-run, the board must not be swapped out from underneath the player.
  const pts = await page.eval(POINTS);
  await page.mouse('mousePressed', pts[0].x, pts[0].y);
  await page.mouse('mouseMoved', pts[1].x, pts[1].y);
  await page.mouse('mouseReleased', pts[1].x, pts[1].y);
  await page.eval('window.__zip.useClock(() => new Date(Date.now() + 86400000)); return 1');
  await page.eval('window.__zip.checkRollover(); return 1');
  await sleep(300);
  const during = await page.eval('return window.__zip.day');
  ok(during === before.day, `a run in progress was interrupted by the rollover (${before.day} -> ${during})`);

  // Once the run is cleared, the new day's board loads.
  await click(page, 'restartBtn');
  await page.eval('window.__zip.checkRollover(); return 1');
  // Wait for the board, not the day: the day is only meaningful once the board
  // it names is actually on screen.
  for (let i = 0; i < 60; i++) {
    const board = await page.eval('return JSON.stringify(window.__zip.state.puzzle.waypoints)');
    if (board !== before.board) break;
    await sleep(50);
  }
  const after = await page.eval(`return {
    day: window.__zip.day,
    board: JSON.stringify(window.__zip.state.puzzle.waypoints),
    filled: window.__zip.state.path.length
  };`);
  ok(after.day === before.day + 1, `day went ${before.day} -> ${after.day}, expected +1`);
  ok(after.board !== before.board, 'the new day served the same board');
  ok(after.filled === 0, 'the new day started with a drawn path');
  await settle(page);
  ok(new RegExp('Daily #' + after.day).test(
       await page.eval("return document.getElementById('dayNumber').textContent")),
     'the daily bar still names yesterday');
  await page.close();
}

// --- the changelog page -----------------------------------------------------
section('the changelog page');
{
  const page = await open();

  // A version people can quote, and a mark when it is one they have not seen.
  const chip = await page.eval("return document.getElementById('versionBtn')?.textContent ?? null");
  ok(/^v\d+\.\d+\.\d+/.test(chip ?? ''), `version chip reads "${chip}"`);
  ok(await page.eval("return !!document.getElementById('versionPip')"),
     'no unseen-release marker on a first visit');
  ok(await page.eval("return !document.getElementById('changelog')"),
     'the changelog is open before it is asked for');

  await click(page, 'versionBtn');
  await settle(page);
  ok(await page.eval("return location.hash === '#changelog'"), 'opening did not set the fragment');
  ok(await page.eval("return !!document.getElementById('changelog')"), 'the changelog did not open');
  ok(await page.eval("return !document.getElementById('versionPip')"),
     'the unseen marker survived opening the changelog');

  const dialog = await page.eval(`
    const p = document.querySelector('.sheet-panel');
    return {
      role: p?.getAttribute('role'),
      modal: p?.getAttribute('aria-modal'),
      labelled: document.getElementById(p?.getAttribute('aria-labelledby') ?? '')?.textContent,
      focused: document.activeElement === p,
      releases: document.querySelectorAll('.release').length,
      versions: [...document.querySelectorAll('.release-version')].map(e => e.textContent),
      bodyScroll: getComputedStyle(document.body).overflow
    };`);
  ok(dialog.role === 'dialog' && dialog.modal === 'true', 'the panel is not an accessible dialog');
  ok(!!dialog.labelled, 'the dialog has no accessible name');
  ok(dialog.focused, 'focus did not move into the dialog');
  ok(await page.eval("return getComputedStyle(document.querySelector('.sheet-panel')).outlineStyle === 'none'"),
     'the dialog container draws a focus ring; that belongs on the controls');
  ok(dialog.releases >= 5, `only ${dialog.releases} releases rendered`);
  ok(dialog.bodyScroll === 'hidden', 'the page behind the sheet still scrolls');

  // Newest first, and the chip agrees with the top entry.
  const ranked = dialog.versions.map(v => v.split('.').map(Number));
  const ordered = ranked.every((v, i) => i === 0 ||
    (v[0] < ranked[i - 1][0]) ||
    (v[0] === ranked[i - 1][0] && v[1] < ranked[i - 1][1]) ||
    (v[0] === ranked[i - 1][0] && v[1] === ranked[i - 1][1] && v[2] < ranked[i - 1][2]));
  ok(ordered, `releases are not newest-first: ${dialog.versions.join(', ')}`);
  ok(chip.startsWith(`v${dialog.versions[0]}`),
     `chip says ${chip} but the newest entry is ${dialog.versions[0]}`);

  // Escape closes it, and the fragment goes back with it.
  await page.send('Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(200);
  await settle(page);
  ok(await page.eval("return !document.getElementById('changelog')"), 'Escape did not close the changelog');
  ok(await page.eval("return location.hash !== '#changelog'"), 'the fragment was left behind');
  ok(await page.eval("return getComputedStyle(document.body).overflow !== 'hidden'"),
     'page scrolling was not restored');
  ok(await page.eval("return !!document.querySelector('#board polyline')"),
     'the board did not survive the changelog');
  await page.close();
}

// --- the changelog is deep-linkable -----------------------------------------
section('the changelog is deep-linkable');
{
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${INDEX}#changelog`);
    // The index, not a game: there is no board to wait for here.
    await sleep(700);
  await settle(page);
  ok(await page.eval("return !!document.getElementById('changelog')"),
     'a shared #changelog link did not open the page');
  await click(page, 'changelogClose');
  await settle(page);
  ok(await page.eval("return !document.getElementById('changelog')"), 'the close button did nothing');
  // Nothing was underneath a cold changelog link, so closing belongs at the index.
  ok(await page.eval("return location.hash === '' && !!document.getElementById('index')"),
     `closing a cold changelog link landed on ${await page.eval('return location.hash')}`);
  // Closing a deep link must not walk off the site: there is no entry of ours
  // behind it to go back to.
  ok(await page.eval("return location.pathname.endsWith('/index.html')"),
     'closing a shared changelog link navigated away from the collection');
  ok(await page.eval("return location.hash === ''"), 'the fragment was left in the address bar');
  ok(await page.eval("return !!document.getElementById('index')"),
     'the collection is gone after closing a deep-linked changelog');
  await page.close();
}

// --- the clock starts when the board is revealed ----------------------------
section('the clock starts when the board is revealed');
{
  const page = await open({ gate: true });
  const covered = await page.eval(`return {
    covered: document.getElementById('board').classList.contains('covered'),
    numbers: document.querySelectorAll('#board text').length,
    walls: document.querySelectorAll('#board g[stroke="var(--wall)"] line').length,
    rules: document.querySelectorAll('#board g[stroke="var(--line)"] line').length,
    start: !!document.getElementById('startBtn'),
    clock: document.getElementById('clock').textContent,
    phase: window.__zip.core.snapshot().phase
  };`);
  ok(covered.covered, 'the board is legible before it is revealed');
  ok(covered.numbers === 0 && covered.walls === 0,
     `a covered board drew ${covered.numbers} numbers and ${covered.walls} walls — that is studyable`);
  ok(covered.rules > 0, 'a covered board shows no grid at all, so you cannot see what size it is');
  ok(covered.start, 'no Start control on a covered board');
  ok(covered.phase === 'ready', `phase is "${covered.phase}"`);
  ok(covered.clock === '0:00.0', `the clock reads ${covered.clock} before the reveal`);

  // Studying is free, but only because nothing can be drawn yet.
  const pts = await page.eval(POINTS);
  await page.drag(pts.slice(0, 5));
  await sleep(400);
  ok(await page.eval('return window.__zip.state.path.length') === 0,
     'the board accepted input before it was revealed');
  ok(await page.eval("return document.getElementById('clock').textContent") === '0:00.0',
     'the clock ran before the reveal');

  // Start counts in, then uncovers and starts the clock together.
  await click(page, 'startBtn');
  await settle(page);
  ok(await page.eval("return !!document.getElementById('countdown')"), 'no count-in after Start');
  const first = await page.eval("return document.getElementById('countdown').textContent");
  ok(first === '3', `count-in began at "${first}"`);
  for (let i = 0; i < 60; i++) {
    if (await page.eval("return window.__zip.core.snapshot().phase") === 'playing') break;
    await sleep(100);
  }
  await settle(page);
  ok(await page.eval("return !document.getElementById('board').classList.contains('covered')"),
     'the board is still covered after the count-in');
  ok(await page.eval("return !document.getElementById('readyGate')"), 'the gate outlived the count-in');
  ok(await page.eval("return document.querySelectorAll('#board text').length >= 4"),
     'the numbers were never drawn after the reveal');

  // The clock runs from the reveal, with no move made.
  await sleep(1000);
  const idle = await page.eval('return window.__zip.state.elapsed');
  ok(idle > 900, `the clock only reached ${Math.round(idle)}ms without a move — it is still waiting for one`);
  ok(await page.eval('return window.__zip.state.path.length') === 0, 'a move was made by accident');
  await page.close();
}

// --- space starts it too, and auto-next does not ask again ------------------
section('space starts it, and auto-next counts itself in');
{
  const page = await open({ gate: true });
  await page.send('Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await settle(page);
  ok(await page.eval("return window.__zip.core.snapshot().phase") !== 'ready',
     'space did not start the puzzle');
  await page.close();

  // In practice with auto-next, finishing one board should roll into the next
  // without asking whether you are ready again.
  const drill = await open();
  await drill.eval("window.__zip.setMode('practice'); return 1");
  await loadPuzzle(drill, 'easy', 1234);
  await drill.drag(await drill.eval(POINTS));
  await sleep(2600);                            // past the auto-next delay
  const next = await drill.eval("return window.__zip.core.snapshot().phase");
  ok(next !== 'ready', `auto-next stopped to ask again (phase "${next}")`);
  await drill.close();
}

// --- the line reads as progress -------------------------------------------
section('the line reads as progress');
{
  const page = await open();
  await loadPuzzle(page, 'medium', 31337);
  const pts = await page.eval(POINTS);

  // Wide enough to read as a pipe rather than a stroke.
  const width = await page.eval(
    "return parseFloat(document.getElementById('ink').getAttribute('stroke-width'))");
  ok(width >= 32, `the line is ${width} units wide on a 100-unit cell`);

  await page.drag(pts.slice(0, 24));
  await settle(page);

  const drawn = await page.eval(`
    const segs = [...document.querySelectorAll('#ink line')]
      .filter(l => l.getAttribute('visibility') === 'visible');
    return {
      count: segs.length,
      first: segs[0]?.getAttribute('stroke'),
      last: segs[segs.length - 1]?.getAttribute('stroke'),
      distinct: new Set(segs.map(l => l.getAttribute('stroke'))).size
    };`);
  ok(drawn.count >= 20, `only ${drawn.count} segments drawn for 24 cells`);
  // Every step has its own colour, and the ends are plainly different.
  ok(drawn.distinct >= 15, `the line only used ${drawn.distinct} colours across ${drawn.count} steps`);
  ok(drawn.first !== drawn.last, `the line starts and ends the same colour (${drawn.first})`);

  // The number being aimed for is ringed in the colour the line will arrive in,
  // so it changes as the board fills rather than being a fixed highlight.
  const ringed = await page.eval(`
    const rings = [...document.querySelectorAll('#board circle')]
      .filter(c => c.getAttribute('fill') === 'none' && c.getAttribute('opacity') === '1');
    return { count: rings.length, colour: rings[0]?.getAttribute('stroke') };`);
  ok(ringed.count === 1, `${ringed.count} numbers are lit as next, expected exactly 1`);
  ok(/^rgb\(/.test(ringed.colour ?? ''), `the next number is ringed "${ringed.colour}"`);

  const before = ringed.colour;
  await page.drag(pts.slice(0, 30));
  await settle(page);
  const after = await page.eval(`
    const rings = [...document.querySelectorAll('#board circle')]
      .filter(c => c.getAttribute('fill') === 'none' && c.getAttribute('opacity') === '1');
    return rings[0]?.getAttribute('stroke');`);
  ok(after !== before, `the next-number highlight stayed ${before} as the board filled`);

  // A number the line has passed through takes the line's colour there.
  const passed = await page.eval(`
    const discs = [...document.querySelectorAll('#board circle')]
      .filter(c => (c.getAttribute('fill') ?? '').startsWith('rgb('));
    return discs.length;`);
  ok(passed >= 2, `only ${passed} numbers took the line's colour`);
  await page.close();
}

// --- the collection index ---------------------------------------------------
section('the collection index');
{
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(INDEX);
  await sleep(700);

  const cards = await page.eval(`
    const cards = [...document.querySelectorAll('.card')];
    return {
      count: cards.length,
      ids: cards.map(c => c.id),
      hrefs: cards.map(c => c.getAttribute('href')),
      named: cards.every(c => (c.querySelector('b')?.textContent ?? '').length > 1),
      described: cards.every(c => (c.querySelector('.card-rules')?.textContent ?? '').length > 30)
    };`);
  ok(cards.count >= 2, `the index lists ${cards.count} games`);
  ok(cards.ids.includes('card-zip') && cards.ids.includes('card-queens'),
     `cards are ${cards.ids.join(', ')}`);
  ok(cards.named && cards.described, 'a card is missing its name or its rules');
  // Real links, so they can be opened in a new tab rather than only clicked.
  ok(cards.hrefs.every(h => /^#\//.test(h ?? '')), `card links are ${cards.hrefs.join(', ')}`);
  ok(await page.eval("return !document.getElementById('board')"), 'the index is rendering a board');

  // Clicking through and coming back.
  await page.eval("document.getElementById('card-queens').click(); return 1");
  await sleep(700);
  // A first-time visitor is met by the rules, and the address says which game's.
  ok(await page.eval("return !!document.getElementById('rules')"),
     'a first visit to a game did not offer its rules');
  ok(await page.eval("return location.hash === '#/queens/help'"),
     `help is at ${await page.eval('return location.hash')}, which no one can share`);
  await page.eval("document.getElementById('rulesClose').click(); return 1");
  await sleep(400);
  ok(await page.eval("return location.hash === '#/queens'"), 'opening a game did not route');
  ok(await page.eval("return !!document.getElementById('board')"), 'the game did not render');
  await page.eval("document.getElementById('backBtn').click(); return 1");
  await sleep(500);
  ok(await page.eval("return !!document.getElementById('index')"), 'going back did not reach the index');

  // Someone handed a help link has no history of ours behind them; closing has
  // to leave them on the game, not eject them to the index.
  await page.goto(`${INDEX}#/zip/help`);
  await sleep(900);
  ok(await page.eval("return !!document.getElementById('rules')"), 'a cold help link showed no rules');
  await page.eval("document.getElementById('rulesClose').click(); return 1");
  await sleep(400);
  ok(await page.eval("return location.hash === '#/zip'"),
     `closing a cold help link landed on ${await page.eval('return location.hash')}`);
  ok(await page.eval("return !!document.getElementById('board')"), 'closing a cold help link lost the board');

  // A deep link straight into a game works without passing through the index.
  await page.goto(`${INDEX}#/zip`);
  await sleep(900);
  ok(await page.eval("return !!window.__zip"), 'a deep link into Zip did not load it');
  ok(await page.eval("return !window.__queens"), 'the other game was loaded too');
  ok(page.consoleErrors.length === 0, `routing errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- Queens plays ------------------------------------------------------------
section('Queens plays');
{
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${INDEX}#/queens`);
  for (let i = 0; i < 100; i++) {
    if (await page.eval('return !!(window.__queens && window.__queens.state.puzzle)')) break;
    await sleep(50);
  }
  ok(await page.eval('return !!window.__queens.state.puzzle'), 'no Queens board arrived');

  // Covered until revealed, like Zip.
  ok(await page.eval("return document.getElementById('board').classList.contains('covered')"),
     'the Queens board is legible before it is revealed');
  await page.eval('window.__queens.reveal(); return 1');
  await settle(page);

  const shape = await page.eval(`
    const n = window.__queens.state.puzzle.n;
    return { n, fills: document.querySelectorAll('#board rect').length };`);
  ok(shape.fills > shape.n * shape.n, `only ${shape.fills} rects drawn for a ${shape.n}x${shape.n} board`);

  // Tapping cycles: empty, marked, queen, empty.
  const first = await page.eval(`
    const z = window.__queens;
    const out = [];
    z.cycle(0); out.push(z.state.marks[0]);
    z.cycle(0); out.push(z.state.marks[0]);
    z.cycle(0); out.push(z.state.marks[0]);
    return out;`);
  ok(shape.n > 0 && first.join(',') === 'blocked,queen,empty',
     `tapping cycled through ${first.join(', ')}`);

  // Two queens that clash must be shown as clashing, not silently ignored.
  const clash = await page.eval(`
    const z = window.__queens, n = z.state.puzzle.n;
    z.restart();
    z.cycle(0); z.cycle(0);            // queen at 0,0
    z.cycle(1); z.cycle(1);            // queen at 0,1 — same row and touching
    return z.state.conflicts.length;`);
  ok(clash === 2, `two clashing queens flagged ${clash} conflicts`);

  // Undo has to mean "the move I just made". Taking the lowest-numbered queen
  // instead looks identical on a board where you happened to play in order.
  const undone = await page.eval(`
    const z = window.__queens, n = z.state.puzzle.n;
    z.restart();
    const late = 0, early = 2 * n + 3;   // play the high cell first, then cell 0
    z.cycle(early); z.cycle(early);
    z.cycle(late); z.cycle(late);
    z.undo();
    return { kept: z.state.marks[early], removed: z.state.marks[late] };`);
  ok(undone.kept === 'queen' && undone.removed === 'empty',
     `undo removed the wrong queen: kept ${undone.kept}, removed ${undone.removed}`);

  const hintUndo = await page.eval(`
    const z = window.__queens;
    z.restart();
    z.hint();
    const after = z.state.marks.filter(m => m === 'queen').length;
    z.undo();
    return { after, then: z.state.marks.filter(m => m === 'queen').length };`);
  ok(hintUndo.after === 1 && hintUndo.then === 0,
     `a hinted queen could not be taken back (${hintUndo.after} then ${hintUndo.then})`);

  // A region that holds its one queen steps back; the rest stay as they were.
  const dimming = await page.eval(`
    const z = window.__queens, p = z.state.puzzle;
    z.restart();
    const cell = p.solution[0] + 0;                 // row 0's queen
    z.cycle(cell); z.cycle(cell);
    const fills = document.querySelector('#board > g').children;   // #board is the svg
    const mine = p.regions[cell];
    const other = [...p.regions].findIndex(r => r !== mine);
    return {
      count: fills.length,
      settled: fills[cell].getAttribute('opacity'),
      untouched: fills[other].getAttribute('opacity')
    };`);
  ok(dimming.count === (await page.eval('return window.__queens.state.puzzle.n ** 2')),
     `expected one fill per cell, found ${dimming.count}`);
  // The depth eases as the board fills, so assert the relationship rather than a
  // number: settled must read as stepped back, and never as far back as it used
  // to go, which turned a nearly-finished dark board to mud.
  const settledOpacity = Number(dimming.settled);
  ok(dimming.untouched === '1', `an untouched region is at ${dimming.untouched}`);
  ok(settledOpacity < 1 && settledOpacity >= 0.4,
     `a settled region is at ${dimming.settled}, which is not a step back`);

  // Queens drives the same progress ramp as Zip rather than leaving it unset.
  const colour = await page.eval("return getComputedStyle(document.getElementById('progressFill')).backgroundColor");
  ok(/^rgb\(/.test(colour) && colour !== 'rgba(0, 0, 0, 0)',
     `the Queens progress bar has no ramp colour (${colour})`);

  // The celebration fires from the move that finished the board.
  const burst = await page.eval(`
    const z = window.__queens, p = z.state.puzzle;
    z.restart();
    const cells = p.solution.map((col, row) => row * p.n + col).reverse();
    for (const c of cells) z.place(c);
    return { last: cells[cells.length - 1], order: z.state.order[z.state.order.length - 1] };`);
  ok(burst.last === burst.order,
     `the celebration would fire from cell ${burst.order}, not the finishing ${burst.last}`);

  // Marking a ruled-out row a square at a time was the slowest part of a board,
  // so a drag crosses the whole run. This needs real mouse input: the hooks go
  // straight to the model and would never notice the gate or a sheet on top.
  // The first-visit rules sheet sits over the board, and so does the ready gate.
  // Both swallow real clicks, and neither is visible to a hook-driven test.
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(400);
  }
  await page.eval('window.__queens.restart(); return 1');
  await page.eval('window.__queens.start(); return 1');
  for (let i = 0; i < 80; i++) {
    if (await page.eval("return window.__queens.state.phase === 'playing'")) break;
    await sleep(100);
  }
  const geo = await page.eval(`
    const r = document.getElementById('board').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, n: window.__queens.state.puzzle.n };`);
  const cellAt = (row, col) => ({
    x: Math.round(geo.left + (col + 0.5) * (geo.w / geo.n)),
    y: Math.round(geo.top + (row + 0.5) * (geo.w / geo.n))
  });

  // Sampled sparsely on purpose: a fast flick must not leave gaps behind it.
  await page.drag([cellAt(3, 0), cellAt(3, 3), cellAt(3, 7)]);
  await sleep(300);
  const row = await page.eval(`
    const q = window.__queens, n = q.state.puzzle.n;
    return q.state.marks.slice(3 * n, 4 * n);`);
  ok(row.every(m => m === 'blocked'), `one drag left row 3 as ${row.join(',')}`);

  await page.eval('window.__queens.restart(); return 1');
  await sleep(200);
  await page.eval(`
    const q = window.__queens, n = q.state.puzzle.n;
    q.cycle(5 * n + 4); q.cycle(5 * n + 4);
    return 1;`);
  await page.drag([cellAt(5, 0), cellAt(5, 3), cellAt(5, 7)]);
  await sleep(300);
  const guarded = await page.eval(`
    const q = window.__queens, n = q.state.puzzle.n;
    return q.state.marks.slice(5 * n, 6 * n);`);
  ok(guarded[4] === 'queen', 'dragging across a placed queen wiped it');
  ok(guarded.filter(m => m === 'blocked').length === guarded.length - 1,
     `the drag left ${guarded.join(',')}`);

  // A tap is still a tap: it must not paint the rest of the row.
  await page.eval('window.__queens.restart(); return 1');
  await sleep(200);
  const spot = cellAt(1, 1);
  await page.drag([spot, spot]);
  await sleep(300);
  const tapped = await page.eval(`
    const q = window.__queens, n = q.state.puzzle.n;
    return { here: q.state.marks[n + 1], crossed: q.state.marks.filter(m => m === 'blocked').length };`);
  ok(tapped.here === 'blocked' && tapped.crossed === 1,
     `a single tap crossed ${tapped.crossed} squares`);

  // The solution solves it, and solving is detected.
  const solved = await page.eval(`
    const z = window.__queens, p = z.state.puzzle;
    z.restart();
    p.solution.forEach((col, row) => z.place(row * p.n + col));
    return { solved: z.state.solved, conflicts: z.state.conflicts.length };`);
  ok(solved.conflicts === 0, `the intended solution reports ${solved.conflicts} conflicts`);
  ok(solved.solved === true, 'placing the solution was not recognised as solved');
  await settle(page);
  ok(/\d:\d\d\.\d/.test(await page.eval("return document.getElementById('bannerText').textContent")),
     'no time reported when Queens was solved');
  ok(page.consoleErrors.length === 0, `Queens errors: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- how to play -------------------------------------------------------------
section('crossing off with a finger');
{
  // The whole game is played on a phone. A touch drag is not a mouse drag: it
  // is the gesture a browser is most likely to steal for scrolling instead.
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 390, height: 844, mobile: true });
  await page.goto(`${INDEX}#/queens`);
  for (let i = 0; i < 100; i++) {
    if (await page.eval('return !!(window.__queens && window.__queens.state.puzzle)')) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(400);
  }
  await page.eval('window.__queens.start(); return 1');
  for (let i = 0; i < 80; i++) {
    if (await page.eval("return window.__queens.state.phase === 'playing'")) break;
    await sleep(100);
  }
  const geo = await page.eval(`
    const r = document.getElementById('board').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, n: window.__queens.state.puzzle.n };`);
  const cell = (row, col) => ({
    x: Math.round(geo.left + (col + 0.5) * (geo.w / geo.n)),
    y: Math.round(geo.top + (row + 0.5) * (geo.w / geo.n))
  });

  const scrollBefore = await page.eval('return window.scrollY');
  await page.touchDrag([cell(2, 0), cell(2, 3), cell(2, 7)]);
  await sleep(400);
  const row = await page.eval(`
    const q = window.__queens, n = q.state.puzzle.n;
    return q.state.marks.slice(2 * n, 3 * n);`);
  ok(row.every(m => m === 'blocked'), `a touch drag left row 2 as ${row.join(',')}`);
  ok(await page.eval('return window.scrollY') === scrollBefore,
     'the touch drag scrolled the page instead of marking the board');
  ok(page.consoleErrors.length === 0, `touch: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

section('how to play');
for (const [game, expect] of [['zip', 'Zip'], ['queens', 'Queens'], ['comet', 'Comet']]) {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${INDEX}#/${game}`);
  await sleep(1400);

  // Shown unasked the first time, because that is when they are wanted.
  ok(await page.eval("return !!document.getElementById('rules')"),
     `${game}: the rules did not appear on a first visit`);
  const sheet = await page.eval(`
    const panel = document.querySelector('#rules .sheet-panel');
    return {
      title: document.getElementById('rulesTitle')?.textContent,
      role: panel?.getAttribute('role'),
      modal: panel?.getAttribute('aria-modal'),
      focused: document.activeElement === panel,
      goal: document.getElementById('rulesGoal')?.textContent ?? '',
      rules: document.querySelectorAll('#rulesList li').length,
      controls: document.querySelectorAll('#rulesControls div').length,
      tips: document.querySelectorAll('#rulesTips li').length,
      diagram: !!document.querySelector('#rules .diagram'),
      diagramLabelled: (document.querySelector('#rules .diagram')?.getAttribute('aria-label') ?? '').length
    };`);
  ok(sheet.title === `How to play ${expect}`, `${game}: titled "${sheet.title}"`);
  ok(sheet.role === 'dialog' && sheet.modal === 'true', `${game}: the sheet is not an accessible dialog`);
  ok(sheet.focused, `${game}: focus did not move into the rules`);
  ok(sheet.goal.length > 30, `${game}: the goal is "${sheet.goal}"`);
  ok(sheet.rules >= 3, `${game}: only ${sheet.rules} rules listed`);
  ok(sheet.controls >= 3, `${game}: only ${sheet.controls} controls listed`);
  ok(sheet.tips >= 2, `${game}: only ${sheet.tips} tips listed`);
  ok(sheet.diagram, `${game}: no worked example`);
  // The picture carries meaning, so it needs a description rather than being
  // hidden or left unlabelled.
  ok(sheet.diagramLabelled > 40, `${game}: the diagram has no useful alt text`);

  // Escape closes it and leaves you on the game.
  await page.send('Input.dispatchKeyEvent',
    { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
  await settle(page);
  ok(await page.eval("return !document.getElementById('rules')"), `${game}: Escape did not close the rules`);
  ok(await page.eval("return !!document.getElementById('board')"), `${game}: the board is gone`);
  ok(await page.eval(`return location.hash === '#/${game}'`),
     `${game}: closing the rules left the fragment at "${await page.eval('return location.hash')}"`);

  // Not shown again, but still reachable.
  await page.reload();
  await sleep(1400);
  ok(await page.eval("return !document.getElementById('rules')"),
     `${game}: the rules reappeared on a return visit`);
  await page.eval("document.getElementById('helpBtn').click(); return 1");
  await settle(page);
  ok(await page.eval("return !!document.getElementById('rules')"),
     `${game}: the help button did not reopen the rules`);
  // The header's ? is one of three identical icons and went unfound, so the
  // gate carries a named way in -- and reading the rules must not start the clock.
  await page.eval("document.getElementById('rulesClose').click(); return 1");
  await sleep(400);
  ok(await page.eval("return !!document.getElementById('gateHelpBtn')"),
     `${game}: no way into the rules from the ready gate`);
  ok(await page.eval("return document.getElementById('gateHelpBtn').textContent.trim()") === 'How to play',
     `${game}: the gate link does not say what it does`);
  const gap = await page.eval(`
    const s = document.getElementById('startBtn').getBoundingClientRect();
    const h = document.getElementById('gateHelpBtn').getBoundingClientRect();
    return Math.round(h.top - s.bottom);`);
  ok(gap >= 0 && gap < 40, `${game}: the gate link sits ${gap}px from Start`);
  await page.eval("document.getElementById('gateHelpBtn').click(); return 1");
  await sleep(500);
  ok(await page.eval("return !!document.getElementById('rules')"),
     `${game}: the gate link did not open the rules`);
  await page.eval("document.getElementById('rulesClose').click(); return 1");
  await sleep(400);
  ok(await page.eval("return !!document.getElementById('startBtn')"),
     `${game}: closing the rules did not return to the gate`);
  ok(await page.eval("return window.__" + game + ".state.elapsed") === 0,
     `${game}: reading the rules started the clock`);

  ok(page.consoleErrors.length === 0, `${game}: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- the production build must not hand out the answer ----------------------
section('the production build must not hand out the answer');
// The hook exposes the solution. That is fine on a random practice board and
// not fine on a shared daily, so it must be absent from what actually ships.
{
  const shipped = await serve('dist');
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${shipped.origin}/index.html?test#/zip`);
  await sleep(400);
  ok(await page.eval('return typeof window.__zip === "undefined"'),
     'the production build still exposes window.__zip');
  ok(await page.eval("return !!document.getElementById('board')"),
     'the production build did not render (so the check above proves nothing)');
  // And the bundle should not even contain the hook's wiring.
  const js = await page.eval(`
    const src = document.querySelector('script[type=module]').src;
    const r = await fetch(src);
    return await r.text();`);
  ok(!js.includes('__zip'), 'the production bundle still contains the test hook');

  // ...and that the production build is the one that goes offline-capable.
  for (let i = 0; i < 40; i++) {
    if (await page.eval('return (await navigator.serviceWorker.getRegistrations()).length > 0')) break;
    await sleep(100);
  }
  ok(await page.eval('return (await navigator.serviceWorker.getRegistrations()).length > 0'),
     'the production build did not register a service worker');
  await page.close();
  await shipped.close();
}

// --- installable and offline ------------------------------------------------
section('installable and offline');
{
  const page = await open();
  const manifestHref = await page.eval(
    "return document.querySelector('link[rel=manifest]')?.getAttribute('href') ?? null");
  ok(manifestHref === './manifest.webmanifest', `manifest link is "${manifestHref}"`);
  ok(await page.eval("return !!document.querySelector('link[rel=apple-touch-icon]')"),
     'no apple-touch-icon for adding to a home screen');

  const manifest = await (await fetch(`${site.origin}/manifest.webmanifest`)).json();
  ok(manifest.display === 'standalone', `display is "${manifest.display}"`);
  // The collection shipped for a while installing itself as "Zip", with Zip's
  // icon, because the manifest was inherited wholesale from the single-game site.
  ok(!/zip/i.test(manifest.name) && !/zip/i.test(manifest.short_name),
     `the installed app is called "${manifest.name}" / "${manifest.short_name}"`);
  ok(manifest.short_name === 'Puzzles', `short_name is "${manifest.short_name}"`);
  ok(manifest.start_url === './' && manifest.scope === './',
     'manifest start_url/scope are not relative, so a subpath deploy breaks');
  ok(!!manifest.theme_color && !!manifest.background_color, 'manifest has no colours');
  const sizes = manifest.icons.map(i => i.sizes).sort();
  ok(sizes.join(',') === '192x192,512x512,512x512', `icon sizes are ${sizes.join(',')}`);
  ok(manifest.icons.some(i => i.purpose === 'maskable'),
     'no maskable icon, so launchers will crop the art');

  // Every icon the manifest names must actually be in the build, at its size.
  for (const icon of manifest.icons) {
    const res = await fetch(`${site.origin}/${icon.src.replace('./', '')}`);
    ok(res.status === 200, `${icon.src} is missing (HTTP ${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    ok(bytes.subarray(1, 4).toString() === 'PNG', `${icon.src} is not a PNG`);
    // PNG stores width/height as big-endian 32-bit ints at offset 16.
    const width = bytes.readUInt32BE(16);
    const expected = Number(icon.sizes.split('x')[0]);
    ok(width === expected, `${icon.src} is ${width}px wide, declared ${expected}`);
  }

  // A worker in front of the dev/test bundle would serve stale code.
  ok(await page.eval('return (await navigator.serviceWorker.getRegistrations()).length === 0'),
     'the test build registered a service worker');
  await page.close();
}

// --- history: the results that were already being stored --------------------
section('history: the results that were already being stored');
{
  const page = await open();
  const day = await page.eval('return window.__zip.day');
  ok(await page.eval("return !document.getElementById('history')"),
     'a history strip is shown before anything has been solved');

  await page.eval(`
    const day = window.__zip.day;
    const times = [52000, 41000, 63000, 47000];
    times.forEach((ms, i) => localStorage.setItem('zip.daily.' + (day - i),
      JSON.stringify({ day: day - i, ms, backtracks: i, hinted: i === 2 })));
    return 1;`);
  await page.reload();
  await ready(page);
  await settle(page);

  const strip = await page.eval(`
    const el = document.getElementById('history');
    return {
      cells: el.querySelectorAll('i').length,
      done: el.querySelectorAll('i.done').length,
      hinted: el.querySelectorAll('i.hinted').length,
      summary: el.querySelector('.history-summary').textContent
    };`);
  ok(strip.cells === Math.min(30, day), `history shows ${strip.cells} days`);
  ok(strip.done === 3 && strip.hinted === 1,
     `history marked ${strip.done} clean and ${strip.hinted} hinted, expected 3 and 1`);
  ok(/4 solved/.test(strip.summary), `summary reads "${strip.summary}"`);
  ok(/best 0:41\.0/.test(strip.summary), `best time wrong in "${strip.summary}"`);
  ok(/median 0:47\.0/.test(strip.summary), `median wrong in "${strip.summary}"`);
  await page.close();
}

// --- link previews ----------------------------------------------------------
section('link previews');
{
  const page = await open();
  const meta = await page.eval(`
    const read = sel => document.querySelector(sel)?.getAttribute('content') ?? null;
    return {
      title: read('meta[property="og:title"]'),
      description: read('meta[property="og:description"]'),
      image: read('meta[property="og:image"]'),
      url: read('meta[property="og:url"]'),
      alt: read('meta[property="og:image:alt"]'),
      card: read('meta[name="twitter:card"]')
    };`);
  ok(!!meta.title && !!meta.description, 'no og:title/og:description for link previews');
  ok(meta.card === 'summary_large_image', `twitter:card is "${meta.card}"`);
  ok(!!meta.alt, 'og:image has no alt text');
  // Absolute, because relative og:image URLs are not resolved by most scrapers.
  ok(/^https:\/\/.+\/og\.png$/.test(meta.image ?? ''), `og:image is not an absolute png: "${meta.image}"`);
  ok(/^https:\/\//.test(meta.url ?? ''), `og:url is not absolute: "${meta.url}"`);
  await page.close();

  // ...and the file it names is actually in the build.
  const res = await fetch(`${site.origin}/og.png`);
  ok(res.status === 200, `og.png is missing from the build (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  ok(bytes.length > 20000, `og.png is only ${bytes.length} bytes`);
  ok(bytes.subarray(1, 4).toString() === 'PNG', 'og.png is not a PNG');
}

// --- sharing prefers the native sheet, and falls back to the clipboard ------
section('sharing prefers the native sheet, and falls back to the clipboard');
{
  const page = await open();
  await page.eval(`
    localStorage.setItem('zip.daily.' + window.__zip.day,
      JSON.stringify({ day: window.__zip.day, ms: 41300, backtracks: 2, hinted: false }));
    return 1;`);
  await page.reload();
  await ready(page);
  await settle(page);
  await stubClipboard(page);

  // With a share sheet available it must be used, and the clipboard left alone.
  await page.eval(`
    window.__shared = null;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async data => { window.__shared = data; }
    });
    return 1;`);
  await click(page, 'shareBtn');
  await sleep(200);
  const shared = await page.eval('return window.__shared');
  ok(shared && /^Zip #\d+ — /.test(shared.text), `native share got "${shared && shared.text}"`);
  ok(await page.eval('return window.__copied') === null,
     'the clipboard was written even though the share sheet handled it');
  ok(/Shared/.test(await page.eval("return document.getElementById('shareBtn').textContent")),
     'no feedback after a native share');

  // Dismissing the sheet is a decision, not a failure: nothing is copied.
  await sleep(1700);                        // let the button label reset
  await page.eval(`
    window.__copied = null;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
    });
    return 1;`);
  await click(page, 'shareBtn');
  await sleep(200);
  ok(await page.eval('return window.__copied') === null,
     'dismissing the share sheet quietly copied to the clipboard instead');

  // Any other share failure must still land the result on the clipboard --
  // desktop Chrome exposes navigator.share but rejects it without a real
  // gesture, which is exactly this case.
  await page.eval(`
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => { const e = new Error('nope'); e.name = 'NotAllowedError'; throw e; }
    });
    return 1;`);
  await click(page, 'shareBtn');
  await sleep(200);
  ok(/^Zip #/.test(await page.eval('return window.__copied') ?? ''),
     'a failed share did not fall back to the clipboard');
  await page.close();
}

console.log(failures === 0
  ? `render  ${checks} browser assertions, 0 failures`
  : `render  ${failures} FAILURES`);

} finally {
  await site.close();
}
process.exit(failures === 0 ? 0 : 1);
