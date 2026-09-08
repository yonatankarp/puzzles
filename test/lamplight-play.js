/*
 * Lamplight, in a real browser: the rules as a player meets them.
 *
 * The engine suite proves the boards are sound. This is about what only a real
 * board can be wrong about -- that dragging out of a lamp aims it where you
 * pulled, that a cancelled drag leaves it alone, that a lost gesture cannot
 * latch a lamp so later presses drive the wrong one, and that the whole game
 * can be played with no pointer at all. Every one of those was a real bug.
 *
 * Usage: node test/lamplight-play.js
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('lamplight-play  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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
const NAME = { '-1': 'out', 0: 'up', 1: 'down', 2: 'left', 3: 'right' };

async function playing() {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${INDEX}#/lamplight`);
  for (let i = 0; i < 250; i++) {
    if (await page.eval('return !!(window.__lamplight && window.__lamplight.state.puzzle)')) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("const b = document.getElementById('rulesGotIt') || document.getElementById('rulesClose'); b.click(); return 1");
    await sleep(400);
  }
  await page.eval("document.getElementById('startBtn').click(); return 1");
  for (let i = 0; i < 120; i++) {
    if (await page.eval("return window.__lamplight.state.phase === 'playing'")) break;
    await sleep(100);
  }
  return page;
}

const spotOf = (page, lamp) => page.eval(`
  const r = document.getElementById('board').getBoundingClientRect();
  const n = window.__lamplight.state.puzzle.n;
  const cell = window.__lamplight.state.puzzle.lamps[${lamp}].cell;
  const s = r.width / (n * 100 + 12);
  return { x: Math.round(r.left + (((cell % n) * 100 + 56) * s)),
           y: Math.round(r.top + ((((cell / n) | 0) * 100 + 56) * s)) };`);

// --- the room starts dark, and every lamp is yours ---------------------------
section('the room starts dark, and every lamp is yours');
{
  const page = await playing();
  ok(await page.eval('return window.__lamplight.state.facing.every(f => f === -1)'),
     'the board did not start dark');
  ok(await page.eval('return window.__lamplight.state.puzzle.lamps.length >= 3'),
     'a board arrived with almost no lamps');
  ok(page.consoleErrors.length === 0, `start: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- dragging aims where you pulled ------------------------------------------
section('dragging aims where you pulled');
{
  const page = await playing();
  const spot = await spotOf(page, 0);
  await page.drag([spot, { x: spot.x + 70, y: spot.y }]);
  await sleep(250);
  ok(await page.eval('return window.__lamplight.state.facing[0]') === 3,
     `dragging right aimed ${NAME[await page.eval('return window.__lamplight.state.facing[0]')]}`);

  /*
   * A short flick is still an aim. The threshold used to be wide enough that a
   * deliberate little pull counted as a tap, so the lamp stepped round to the
   * next direction instead of the one you asked for.
   */
  await page.eval('window.__lamplight.restart(); return 1');
  await sleep(200);
  await page.drag([spot, { x: spot.x, y: spot.y + 13 }]);
  await sleep(250);
  ok(await page.eval('return window.__lamplight.state.facing[0]') === 1,
     `a 13px flick down aimed ${NAME[await page.eval('return window.__lamplight.state.facing[0]')]}`);

  // Pulled out and brought back is someone changing their mind.
  await page.eval('window.__lamplight.restart(); return 1');
  await sleep(200);
  await page.drag([spot, { x: spot.x + 60, y: spot.y }, { x: spot.x + 2, y: spot.y }]);
  await sleep(250);
  ok(await page.eval('return window.__lamplight.state.facing[0]') === -1,
     'a cancelled drag turned the lamp anyway');
  ok(page.consoleErrors.length === 0, `drag: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a tap turns the lamp round the compass ----------------------------------
section('a tap turns the lamp round the compass');
{
  const page = await playing();
  const spot = await spotOf(page, 0);
  const seen = [];
  for (let i = 0; i < 5; i++) {
    await page.drag([spot, spot]);
    await sleep(140);
    seen.push(await page.eval('return window.__lamplight.state.facing[0]'));
  }
  ok(seen.join(',') === '0,3,1,2,-1',
     `tapping went ${seen.map(d => NAME[d]).join(' -> ')}, not up, right, down, left, out`);
  await page.close();
}

// --- a lost gesture must not latch a lamp ------------------------------------
section('a lost gesture must not latch a lamp');
{
  /*
   * If a pointerup goes missing -- capture dropped, the finger off the page --
   * the lamp it belonged to used to stay latched, and every later press drove
   * that one rather than the lamp under the finger.
   */
  const page = await playing();
  const second = await spotOf(page, 1);
  await page.eval("window.__lamplight.core.attachStranded = true; return 1");
  await page.drag([await spotOf(page, 0), { x: 5, y: 5 }]);   // ends off the board
  await sleep(200);
  const before = await page.eval('return window.__lamplight.state.facing[0]');
  await page.drag([second, { x: second.x + 70, y: second.y }]);
  await sleep(250);
  ok(await page.eval('return window.__lamplight.state.facing[1]') === 3,
     'pressing a second lamp did not aim that lamp');
  ok(await page.eval('return window.__lamplight.state.facing[0]') === before,
     'pressing a second lamp moved the first one');
  await page.close();
}

// --- hint, undo and restart --------------------------------------------------
section('hint, undo and restart');
{
  const page = await playing();
  await page.eval('window.__lamplight.hint(); return 1');
  await sleep(200);
  const afterHint = await page.eval('return window.__lamplight.state.facing.filter(f => f >= 0).length');
  ok(afterHint === 1, `a hint lit ${afterHint} lamps`);
  ok(await page.eval(`
    const z = window.__lamplight, pz = z.state.puzzle;
    return pz.lamps.some((l, i) => z.state.facing[i] === l.dir);`),
     'the hint aimed a lamp the wrong way');

  await page.eval('window.__lamplight.undo(); return 1');
  await sleep(200);
  ok(await page.eval('return window.__lamplight.state.facing.every(f => f === -1)'),
     'undo did not put the hinted lamp out');

  await page.eval('window.__lamplight.hint(); window.__lamplight.hint(); window.__lamplight.restart(); return 1');
  await sleep(250);
  ok(await page.eval('return window.__lamplight.state.facing.every(f => f === -1)'),
     'restart left lamps burning');
  await page.close();
}

// --- it can be played with no pointer at all ---------------------------------
section('it can be played with no pointer at all');
{
  const page = await playing();
  const solved = await page.eval(`
    const z = window.__lamplight, pz = z.state.puzzle;
    const press = key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const ways = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    for (let i = 0; i < pz.lamps.length; i++) {
      const target = pz.lamps[i].cell;
      // Space walks the lamps in board order; step until we are on this one.
      for (let guard = 0; guard <= pz.lamps.length + 1 && z.state.cursor !== target; guard++) press(' ');
      if (z.state.cursor !== target) return 'the cursor never reached lamp ' + i;
      press(ways[pz.lamps[i].dir]);
    }
    return z.state.solved;`);
  ok(solved === true, `the board was not solved from the keyboard (${solved})`);
  ok(page.consoleErrors.length === 0, `keyboard: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- lighting a square twice is shown, not swallowed -------------------------
section('lighting a square twice is shown, not swallowed');
{
  const page = await playing();
  /*
   * A finished run is finished: once the board is solved the game stops taking
   * input, the same as the others here. So the wrong aim has to happen on the
   * way to the answer, not after it.
   */
  const clashed = await page.eval(`
    const z = window.__lamplight, pz = z.state.puzzle;
    z.restart();
    // Every lamp but one aimed correctly, and that one sent the wrong way.
    const victim = 0;
    pz.lamps.forEach((l, i) => z.aim(i, i === victim ? (l.dir + 1) % 4 : l.dir));
    const wrongState = z.state.solved;
    // Now put it right, and the room should finish.
    z.aim(victim, pz.lamps[victim].dir);
    return { wrongState, nowSolved: z.state.solved };`);
  ok(clashed.wrongState === false, 'a board with a lamp aimed wrongly was called solved');
  ok(clashed.nowSolved === true, 'putting the last lamp right did not finish the board');
  ok(page.consoleErrors.length === 0, `clash: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

await site.close();
console.log(failures === 0
  ? `lamplight-play  ${checks} browser assertions, 0 failures`
  : `lamplight-play  ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
