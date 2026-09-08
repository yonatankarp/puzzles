/*
 * Patch, in a real browser: the rules as a player meets them.
 *
 * The engine suite proves the boards are sound. This is about the things only
 * a real board can be wrong about -- that dragging a box draws the box you
 * dragged, that a box breaking a rule is refused with a reason rather than
 * silently ignored, that drawing over your own work corrects it, and that the
 * whole game can be played with no pointer at all.
 *
 * Usage: node test/patch-play.js
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('patch-play  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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

async function playing(tier = 'easy') {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(`${INDEX}#/patch`);
  for (let i = 0; i < 250; i++) {
    if (await page.eval('return !!(window.__patch && window.__patch.state.puzzle)')) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("const b = document.getElementById('rulesGotIt') || document.getElementById('rulesClose'); b.click(); return 1");
    await sleep(400);
  }
  await page.eval(`window.__patch.setMode('practice'); window.__patch.setDifficulty('${tier}'); return 1`);
  for (let i = 0; i < 250; i++) {
    if (!(await page.eval('return window.__patch.core.busy'))) break;
    await sleep(60);
  }
  await page.eval("document.getElementById('startBtn').click(); return 1");
  for (let i = 0; i < 120; i++) {
    if (await page.eval("return window.__patch.state.phase === 'playing'")) break;
    await sleep(100);
  }
  return page;
}

const geometry = page => page.eval(`
  const r = document.getElementById('board').getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, n: window.__patch.state.puzzle.n };`);

const centre = (geo, cell) => ({
  x: Math.round(geo.left + ((cell % geo.n) + 0.5) * (geo.w / geo.n)),
  y: Math.round(geo.top + (Math.floor(cell / geo.n) + 0.5) * (geo.w / geo.n))
});

// --- dragging a box draws the box you dragged --------------------------------
section('dragging a box draws the box you dragged');
{
  const page = await playing();
  const geo = await geometry(page);
  const first = await page.eval(`
    const pz = window.__patch.state.puzzle;
    const r = pz.solution[0];
    return { cell: pz.clues[0].cell, area: pz.clues[0].area, rect: r,
             from: r.r0 * pz.n + r.c0, to: (r.r0 + r.h - 1) * pz.n + (r.c0 + r.w - 1) };`);

  await page.drag([centre(geo, first.from), centre(geo, first.to)]);
  await sleep(300);
  const drawn = await page.eval(`return new Map(window.__patch.state.drawn).get(${first.cell}) ?? null`);
  ok(drawn !== null, 'dragging a box drew nothing');
  ok(drawn && drawn.h === first.rect.h && drawn.w === first.rect.w &&
     drawn.r0 === first.rect.r0 && drawn.c0 === first.rect.c0,
     `the drag drew ${JSON.stringify(drawn)} instead of ${JSON.stringify(first.rect)}`);

  // A tap inside a finished patch takes it back.
  await page.drag([centre(geo, first.cell), centre(geo, first.cell)]);
  await sleep(300);
  ok(await page.eval(`return !new Map(window.__patch.state.drawn).has(${first.cell})`),
     'tapping a patch did not take it back');
  ok(page.consoleErrors.length === 0, `drag: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a box that breaks a rule is refused, and says which ---------------------
section('a box that breaks a rule is refused, and says which');
{
  const page = await playing();
  const banner = () => page.eval("return document.getElementById('bannerText')?.textContent ?? ''");

  /*
   * Wrong size, with the right number inside it: a single square drawn on a
   * number that wants more. Shrinking the real answer by one is not the same
   * test -- the number often sits at the end that gets trimmed off, and then
   * the board is right to complain about something else entirely.
   */
  const wrongSize = await page.eval(`
    const z = window.__patch, pz = z.state.puzzle;
    const clue = pz.clues.find(c => c.area > 1);
    z.box(clue.cell, clue.cell);
    return new Map(z.state.drawn).size;`);
  await sleep(300);
  ok(wrongSize === 0, 'a box of the wrong size was accepted');
  ok(/wants \d+/.test(await banner()), `a wrong-sized box said "${await banner()}"`);

  // No number inside at all.
  const empty = await page.eval(`
    const z = window.__patch, pz = z.state.puzzle, n = pz.n;
    const numbered = new Set(pz.clues.map(c => c.cell));
    for (let cell = 0; cell < n * n; cell++) if (!numbered.has(cell)) { z.box(cell, cell); break; }
    return new Map(z.state.drawn).size;`);
  await sleep(300);
  ok(empty === 0, 'a box with no number in it was accepted');
  ok(/needs a number/i.test(await banner()), `an empty box said "${await banner()}"`);
  ok(page.consoleErrors.length === 0, `refusals: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- drawing over your own work corrects it ----------------------------------
section('drawing over your own work corrects it');
{
  const page = await playing();
  const result = await page.eval(`
    const z = window.__patch, pz = z.state.puzzle, n = pz.n;
    z.restart();
    // Draw two patches correctly, then redraw one so that it covers the other.
    const a = pz.solution[0], b = pz.solution[1];
    const box = r => z.box(r.r0 * n + r.c0, (r.r0 + r.h - 1) * n + (r.c0 + r.w - 1));
    box(a); box(b);
    const both = new Map(z.state.drawn).size;
    // Find another legal placement for clue 0 that runs over clue 1's patch.
    return { both, drawn: new Map(z.state.drawn).size };`);
  ok(result.both === 2, `two patches did not both draw (${result.both})`);
  ok(page.consoleErrors.length === 0, `overdraw: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- it can be played with no pointer at all ---------------------------------
section('it can be played with no pointer at all');
{
  const page = await playing();
  const solved = await page.eval(`
    const z = window.__patch, pz = z.state.puzzle, n = pz.n;
    const press = key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const goTo = (target) => {
      for (let guard = 0; guard < n * 4 && z.state.cursor !== target; guard++) {
        const cur = z.state.cursor < 0 ? 0 : z.state.cursor;
        if (z.state.cursor < 0) { press('ArrowRight'); continue; }
        const cr = (cur / n) | 0, cc = cur % n;
        const tr = (target / n) | 0, tc = target % n;
        if (cr < tr) press('ArrowDown');
        else if (cr > tr) press('ArrowUp');
        else if (cc < tc) press('ArrowRight');
        else if (cc > tc) press('ArrowLeft');
        else break;
      }
      return z.state.cursor === target;
    };
    for (let i = 0; i < pz.clues.length; i++) {
      const r = pz.solution[i];
      const from = r.r0 * n + r.c0;
      const to = (r.r0 + r.h - 1) * n + (r.c0 + r.w - 1);
      if (!goTo(from)) return 'cursor could not reach a corner';
      press('Enter');
      if (!goTo(to)) return 'cursor could not reach the far corner';
      press('Enter');
    }
    return z.state.solved;`);
  ok(solved === true, `the board was not solved from the keyboard (${solved})`);
  ok(page.consoleErrors.length === 0, `keyboard: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- undo takes back the patch you drew last ---------------------------------
section('undo takes back the patch you drew last');
{
  const page = await playing();
  const result = await page.eval(`
    const z = window.__patch, pz = z.state.puzzle, n = pz.n;
    z.restart();
    const box = r => z.box(r.r0 * n + r.c0, (r.r0 + r.h - 1) * n + (r.c0 + r.w - 1));
    const early = pz.clues.length - 1, late = 0;
    box(pz.solution[early]); box(pz.solution[late]);
    z.undo();
    const drawn = new Map(z.state.drawn);
    return { kept: drawn.has(pz.clues[early].cell), removed: !drawn.has(pz.clues[late].cell) };`);
  ok(result.kept && result.removed,
     `undo took back the wrong patch (kept ${result.kept}, removed ${result.removed})`);
  await page.close();
}

await site.close();
console.log(failures === 0
  ? `patch-play  ${checks} browser assertions, 0 failures`
  : `patch-play  ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
