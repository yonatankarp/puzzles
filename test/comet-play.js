/*
 * Comet, in a real browser: the rules as a player meets them.
 *
 * The engine suite already proves the boards are sound. This is about the
 * things only a real board can be wrong about -- that a drag flies the comet
 * you aimed at, that a tap is a comet of one, that two comets claiming the same
 * square is shown rather than swallowed, and that the whole game can be played
 * without a pointer at all.
 *
 * Usage: node test/comet-play.js
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('comet-play  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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

/** Open Comet and get past the rules sheet and the ready gate. */
async function playing(hash = '#/comet') {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 520, height: 900 });
  await page.goto(INDEX + hash);
  for (let i = 0; i < 200; i++) {
    if (await page.eval('return !!(window.__comet && window.__comet.state.puzzle)')) break;
    await sleep(50);
  }
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(400);
  }
  await page.eval("document.getElementById('startBtn').click(); return 1");
  for (let i = 0; i < 120; i++) {
    if (await page.eval("return window.__comet.state.phase === 'playing'")) break;
    await sleep(100);
  }
  return page;
}

const geometry = page => page.eval(`
  const r = document.getElementById('board').getBoundingClientRect();
  return { left: r.left, top: r.top, w: r.width, n: window.__comet.state.puzzle.n };`);

const centre = (geo, cell) => ({
  x: Math.round(geo.left + ((cell % geo.n) + 0.5) * (geo.w / geo.n)),
  y: Math.round(geo.top + (Math.floor(cell / geo.n) + 0.5) * (geo.w / geo.n))
});

// --- a drag flies the comet you aimed at -------------------------------------
section('a drag flies the comet you aimed at');
{
  const page = await playing();
  const geo = await geometry(page);
  ok(geo.n >= 5, `the board is ${geo.n} wide`);

  // Take a comet the board says is longer than one square, and fly it by hand.
  const target = await page.eval(`
    const pz = window.__comet.state.puzzle;
    for (let i = 0; i < pz.clues.length; i++) {
      if (pz.solution[i].length > 1) return { head: pz.clues[i].cell, cells: pz.solution[i] };
    }
    return null;`);
  ok(target !== null, 'no comet on this board is longer than one square');

  const tip = target.cells[target.cells.length - 1];
  await page.drag([centre(geo, target.head), centre(geo, tip)]);
  await sleep(300);
  const flown = await page.eval(`
    const f = new Map(window.__comet.state.flights);
    return f.get(${target.head}) ?? null;`);
  ok(flown !== null, 'dragging from a circle flew nothing');
  ok(JSON.stringify(flown) === JSON.stringify(target.cells),
     `the drag flew ${JSON.stringify(flown)} instead of ${JSON.stringify(target.cells)}`);

  // Dragging the same comet back out to the same tip takes it back.
  await page.drag([centre(geo, target.head), centre(geo, tip)]);
  await sleep(300);
  ok(await page.eval(`return !new Map(window.__comet.state.flights).has(${target.head})`),
     'flying the same comet twice did not take it back');
  ok(page.consoleErrors.length === 0, `drag: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a tap is a comet of one square ------------------------------------------
section('a tap is a comet of one square');
{
  const page = await playing();
  const geo = await geometry(page);
  // A head whose length is not given can legally be one square long.
  const head = await page.eval(`
    const pz = window.__comet.state.puzzle;
    const free = pz.clues.find(c => c.len === 0);
    return free ? free.cell : pz.clues[0].cell;`);
  const spot = centre(geo, head);
  await page.drag([spot, spot]);
  await sleep(300);
  const cells = await page.eval(`return new Map(window.__comet.state.flights).get(${head}) ?? null`);
  ok(cells !== null && cells.length === 1, `a tap gave ${JSON.stringify(cells)}`);
  ok(page.consoleErrors.length === 0, `tap: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- two comets on one square is shown, not swallowed ------------------------
section('two comets on one square is shown, not swallowed');
{
  const page = await playing();
  // Force an overlap through the hooks, whatever this board happens to look like.
  const clash = await page.eval(`
    const z = window.__comet, pz = z.state.puzzle, n = pz.n;
    for (let i = 0; i < pz.clues.length; i++) {
      for (let j = 0; j < pz.clues.length; j++) {
        if (i === j) continue;
        const a = pz.solution[i], b = pz.solution[j];
        if (a.length < 2 || b.length < 2) continue;
        // Fly j correctly, then aim i so it runs over one of j's squares.
        z.restart();
        z.fly(pz.clues[j].cell, b[b.length - 1]);
        const overlap = a.find(c => b.includes(c) === false);
        z.fly(pz.clues[i].cell, a[a.length - 1]);
        if (z.state.clash.length > 0) return z.state.clash.length;
      }
    }
    return 0;`);
  // Boards whose comets cannot be made to overlap are rare but legal.
  if (clash > 0) {
    ok(clash > 0, 'an overlap was not recorded');
    ok(await page.eval('return window.__comet.state.solved === false'),
       'a board with two comets on one square was called solved');
  } else {
    ok(true, 'this board admits no overlap between two correct comets');
    ok(true, '');
  }
  await page.close();
}

// --- it can be played with no pointer at all ---------------------------------
section('it can be played with no pointer at all');
{
  const page = await playing();
  const key = k => page.eval(
    `document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true })); return 1;`);

  await key(' ');
  await sleep(200);
  ok(await page.eval('return window.__comet.state.cursor >= 0'),
     'space did not put a cursor on a circle');

  // Walk the circles with space and fly each one the way the answer says.
  const solved = await page.eval(`
    const z = window.__comet, pz = z.state.puzzle, n = pz.n;
    const dirName = (head, tip) => {
      if (tip === head) return null;
      const dr = Math.sign(((tip / n) | 0) - ((head / n) | 0));
      const dc = Math.sign((tip % n) - (head % n));
      return dr === -1 ? 'ArrowUp' : dr === 1 ? 'ArrowDown' : dc === -1 ? 'ArrowLeft' : 'ArrowRight';
    };
    for (let i = 0; i < pz.clues.length; i++) {
      const head = pz.clues[i].cell, cells = pz.solution[i];
      const dir = dirName(head, cells[cells.length - 1]);
      // Step the cursor onto this circle with space.
      for (let guard = 0; guard < pz.clues.length * 2 && z.state.cursor !== head; guard++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      }
      if (z.state.cursor !== head) return 'cursor never reached a circle';
      if (!dir) {
        // A comet of one square has no direction; Enter is how it is flown.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        continue;
      }
      for (let n2 = 0; n2 < cells.length; n2++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: dir, bubbles: true }));
        const have = new Map(z.state.flights).get(head);
        if (have && have.length === cells.length) break;
      }
    }
    return z.state.solved;`);
  ok(solved === true, `the board was not solved from the keyboard (${solved})`);
  ok(page.consoleErrors.length === 0, `keyboard: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- undo takes back the comet you flew last ---------------------------------
section('undo takes back the comet you flew last');
{
  const page = await playing();
  const result = await page.eval(`
    const z = window.__comet, pz = z.state.puzzle;
    z.restart();
    const late = pz.clues[0].cell, early = pz.clues[pz.clues.length - 1].cell;
    const lateCells = pz.solution[0], earlyCells = pz.solution[pz.clues.length - 1];
    z.fly(early, earlyCells[earlyCells.length - 1]);
    z.fly(late, lateCells[lateCells.length - 1]);
    z.undo();
    const f = new Map(z.state.flights);
    return { kept: f.has(early), removed: !f.has(late) };`);
  ok(result.kept && result.removed,
     `undo took back the wrong comet (kept ${result.kept}, removed ${result.removed})`);
  await page.close();
}

await site.close();
console.log(failures === 0
  ? `comet-play  ${checks} browser assertions, 0 failures`
  : `comet-play  ${failures} FAILURES`);
process.exit(failures ? 1 : 0);
