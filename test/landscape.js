/*
 * A phone on its side, for every game and both modes.
 *
 * The landscape layout puts the board in one column and the chrome in the
 * other, and it placed that chrome by counting rows: the controls on row 5,
 * the status row on 6, "the second status row" on 7. The pin for that second
 * row was written `.status + .status`, which is not the second one -- it is
 * every one after the first. Queens practice has four of them, so three landed
 * in the same cell and printed on top of each other, with the daily's history
 * strip pinned to that cell as well.
 *
 * Nothing caught it because every rule involved was individually correct and
 * every element was present in the DOM. So this measures what is actually on
 * screen: no two boxes sharing space, nothing scrolling in either direction,
 * and the header still the size it was designed to be rather than crushed to
 * fit a column narrower than any width the stylesheet breaks on.
 *
 * Usage: node test/landscape.js [--shots <dir>]
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';

if (!findChrome()) {
  console.log('landscape  skipped — no Chrome found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1]
  : null;

let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/*
 * Real phones on their sides. 852x393 is a current large iPhone, 667x375 the
 * SE and the 8, and 568x320 the shortest landscape any iPhone ever had -- the
 * one that decides whether the tightest rules in the stylesheet are enough.
 */
const VIEWPORTS = [[852, 393], [667, 375], [568, 320]];
const GAMES = ['zip', 'queens', 'patch', 'lamplight'];

const site = await serve('dist-test');

let tightest = Infinity;
let worst = { slack: Infinity, at: '' };

/* What the page is actually made of, measured rather than assumed. */
const MEASURE = `
  const wrap = document.querySelector('.wrap');
  const shown = [...wrap.children].filter(el => getComputedStyle(el).display !== 'none');
  const boxes = shown.map(el => {
    const b = el.getBoundingClientRect();
    return {
      name: (el.className || el.tagName).toString().split(' ')[0],
      x: Math.round(b.x), y: Math.round(b.y),
      w: Math.round(b.width), h: Math.round(b.height)
    };
  });
  // Two boxes overlap when they share space on both axes. A pixel or two of
  // touching is a rounded edge, not a collision.
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      const dy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      const dx = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      if (dy > 2 && dx > 2) overlaps.push(a.name + ' over ' + c.name);
    }
  }
  const icons = [...document.querySelectorAll('.icon-btn')]
    .map(e => Math.round(e.getBoundingClientRect().width));
  const clock = document.querySelector('.clock');
  return {
    overlaps,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    minIcon: icons.length ? Math.min(...icons) : null,
    clockRight: clock ? Math.round(clock.getBoundingClientRect().right) : null,
    // How much room is left under the longest column. Not asserted against a
    // number -- a Linux runner draws this text a shade taller than a Mac does,
    // so any threshold would mean different things in the two places -- but
    // printed, because the first version of this layout passed here by four
    // pixels and failed in CI by four, and a margin nobody can see is a margin
    // nobody notices shrinking.
    slack: window.innerHeight - Math.round(Math.max(...boxes.map(b => b.y + b.h))),
    boardOnScreen: (() => {
      const b = document.querySelector('svg.board');
      if (!b) return true;
      const r = b.getBoundingClientRect();
      return r.width > 40 && r.bottom <= window.innerHeight + 2;
    })()
  };`;

try {

for (const [width, height] of VIEWPORTS) {
  for (const game of GAMES) {
    for (const mode of ['daily', 'practice']) {
      const page = await launch();
      // A real phone reports a coarse pointer, and the stylesheet answers it by
      // trading the keyboard hints for a shorter line. Measuring without it
      // measures a layout no phone ever gets.
      await page.setup({ scheme: 'dark', width, height, mobile: true });
      await page.goto(`${site.origin}/index.html?test#/${game}`);
      for (let i = 0; i < 120; i++) {
        if (await page.eval(`return !!window.__${game}`)) break;
        await sleep(50);
      }
      if (await page.eval("return !!document.getElementById('rules')")) {
        await page.eval("document.getElementById('rulesClose').click(); return 1");
        await sleep(250);
      }
      await page.eval(`window.__${game}.setMode('${mode}'); return 1`);
      await sleep(400);

      const at = `${width}×${height} ${game} ${mode}`;
      const m = await page.eval(MEASURE);
      tightest = Math.min(tightest, m.slack);
      if (m.slack < worst.slack) worst = { slack: m.slack, at };

      ok(m.overlaps.length === 0, `${at}: ${m.overlaps.join('; ')}`);
      ok(m.scrollW <= m.innerW + 1,
         `${at}: the page scrolls sideways (${m.scrollW} wide in ${m.innerW})`);
      ok(m.scrollH <= m.innerH + 1,
         `${at}: the page scrolls down (${m.scrollH} tall in ${m.innerH}, ` +
         `${-m.slack}px past the bottom)`);
      // The header's box here is the chrome column, not the viewport, which is
      // how these came to be squeezed to 17px with their touch target on them.
      ok(m.minIcon === null || m.minIcon >= 30,
         `${at}: the header buttons are ${m.minIcon}px wide, not the 34 they are drawn at`);
      ok(m.clockRight === null || m.clockRight <= m.innerW,
         `${at}: the clock runs off the side (right edge ${m.clockRight} of ${m.innerW})`);
      ok(m.boardOnScreen, `${at}: the board is not fully on screen`);

      if (shotDir && mode === 'practice') {
        await page.screenshot(`${shotDir}/landscape-${width}-${game}.png`);
      }
      ok(page.consoleErrors.length === 0, `${at}: ${page.consoleErrors.join(' | ')}`);
      await page.close();
    }
  }
  console.log(`  ${width}×${height}  ${failures === 0 ? 'clean' : 'FAILURES'}`);
}

console.log(`  tightest board: ${worst.at}, ${worst.slack}px to spare`);
console.log(failures === 0
  ? `landscape  ${checks} browser assertions, 0 failures`
  : `landscape  ${checks} browser assertions, ${failures} failures`);

} finally {
  await site.close();
}
process.exit(failures === 0 ? 0 : 1);
