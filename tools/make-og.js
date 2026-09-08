/*
 * Generates public/og.png — the card that renders when the link is pasted
 * anywhere. The boards in it are not mock-ups: the real app is loaded, real
 * puzzles are part-solved, and their <svg> is lifted out and dropped into the
 * card layout. The card therefore cannot drift from what the games actually
 * look like. Run after a visual change: node tools/make-og.js
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import { launch, sleep, findChrome } from '../test/browser.js';
import { serve } from '../test/serve.js';

if (!findChrome()) {
  console.error('no Chrome found; cannot render the card');
  process.exit(1);
}

const ZIP_SEED = 31337;
const ZIP_DRAWN = 22;             // cells of the solution to show, out of 36
const QUEENS_SEED = 4242;
const QUEENS_PLACED = 4;          // enough to look underway, not enough to spoil

// The test build, because it is the only one that exposes the hooks used to
// part-solve a board -- the shipped build deliberately hands out nothing.
const site = await serve('dist-test');

/** Load one game, part-solve it, and lift its board out of the live page. */
async function boardOf(game, setup, solve) {
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 700, height: 1000 });
  await page.goto(`${site.origin}/index.html?test#/${game}`);
  // Routing loads a game asynchronously, so its hooks appear a moment later.
  for (let i = 0; i < 40 && !(await page.eval(`return !!window.__${game}`)); i++) await sleep(100);
  await page.eval(setup);
  // start() opens the reveal countdown rather than the board; until it lands on
  // 'playing' the puzzle is still covered and every move is refused.
  for (let i = 0; i < 80; i++) {
    if (await page.eval(`return window.__${game}.state.phase === 'playing'`)) break;
    await sleep(100);
  }
  await page.eval(solve);
  await sleep(200);
  const svg = await page.eval("return document.getElementById('board').outerHTML");
  await page.close();
  return svg;
}

const zip = await boardOf('zip', `
  const z = window.__zip;
  z.setMode('practice');
  z.load(z.generate('medium', ${ZIP_SEED}));
  z.start();
  return 1;`, `
  const z = window.__zip, s = z.state.puzzle.solution;
  for (let i = 0; i < ${ZIP_DRAWN}; i++) z.step(s[i]);
  return 1;`);

const queens = await boardOf('queens', `
  const q = window.__queens;
  q.setMode('practice');
  q.load(q.generate('medium', ${QUEENS_SEED}));
  q.start();
  return 1;`, `
  const q = window.__queens, p = q.state.puzzle;
  for (let row = 0; row < ${QUEENS_PLACED}; row++) q.place(row * p.n + p.solution[row]);
  return 1;`);

// The dark palette, copied from styles.css, because the lifted SVGs paint
// themselves entirely through these tokens.
const CARD = `<!doctype html><meta charset="utf-8"><style>
  :root {
    --board: #131720; --line: #272d3a; --ink: #e9edf5; --dim: #868fa3;
    --accent: #f5b544; --accent-ink: #14161c; --path: #4d8bff;
    --path-ink: #ffffff; --wall: #c2cbdd; --good: #35d07f; --bad: #ff6259;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 56px;
    padding: 0 68px; background: #0e1014; color: var(--ink); overflow: hidden;
    font: 400 22px/1.5 ui-sans-serif, -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
  }
  .copy { flex: 1; }
  .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .brand svg { display: block; }
  .brand span { font-weight: 700; font-size: 44px; letter-spacing: -.02em; }
  h1 { font-weight: 600; font-size: 52px; line-height: 1.16; letter-spacing: -.025em; margin-bottom: 20px; }
  p { color: var(--dim); font-size: 24px; max-width: 22ch; }
  .boards { display: flex; gap: 26px; flex: none; }
  .board { width: 268px; }
  .board svg { width: 100%; height: auto; display: block; }
  .board figcaption { color: var(--dim); font-size: 19px; margin-top: 14px; text-align: center; }
</style>
<div class="copy">
  <div class="brand">
    <svg width="52" height="52" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="var(--accent)"></rect>
      <g fill="var(--accent-ink)">
        <rect x="8" y="8" width="7" height="7" rx="1.5"></rect>
        <rect x="17" y="8" width="7" height="7" rx="1.5"></rect>
        <rect x="8" y="17" width="7" height="7" rx="1.5"></rect>
        <rect x="17" y="17" width="7" height="7" rx="3.5"></rect>
      </g>
    </svg>
    <span>Puzzles</span>
  </div>
  <h1>One solution.<br>Always.</h1>
  <p>Auto-generated boards with a measured difficulty, and a new one every day.</p>
</div>
<div class="boards">
  <figure class="board">${zip}<figcaption>Zip</figcaption></figure>
  <figure class="board">${queens}<figcaption>Queens</figcaption></figure>
</div>`;

const temp = 'dist-test/__og.html';
writeFileSync(temp, CARD);

const shot = await launch();
await shot.setup({ scheme: 'dark', width: 1200, height: 630, deviceScaleFactor: 2 });
await shot.goto(`${site.origin}/__og.html`);
await sleep(300);
await shot.screenshot('public/og.png');
await shot.close();

unlinkSync(temp);
await site.close();
console.log('public/og.png written from the live renderer');
process.exit(0);
