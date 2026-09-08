/*
 * Colour and layout accessibility, measured in the page rather than read off
 * the stylesheet.
 *
 * render.js already samples body text, the tier stats and the primary button,
 * which is why the palette's *stateful* colours drifted unnoticed: the solved
 * clock, the win banner, the error banner and the focus ring are only on screen
 * in states no contrast check ever reached, and the light theme was missing
 * token values for several of them. This suite drives the app into each of
 * those states, in both themes, and reads the colours that actually rendered.
 *
 * It also holds the two rules that keep the narrow-phone header honest: nothing
 * may scroll sideways, and the control hint and the game's name both stay on
 * screen at 320px.
 *
 * Usage: node test/contrast.js
 */
import { launch, sleep, findChrome } from './browser.js';
import { serve } from './serve.js';
import { writeSync } from 'node:fs';

if (!findChrome()) {
  console.log('contrast  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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

// The same helper render.js uses, so the numbers here are comparable with the
// ones there: WCAG relative luminance over sRGB, and the 4.5 / 3.0 thresholds.
const parseRgb = text => (text.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
const luminance = ([r, g, b]) => {
  const f = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [luminance(parseRgb(a)), luminance(parseRgb(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const at = (ratio, floor, label) =>
  ok(ratio >= floor, `${label} is ${ratio.toFixed(2)}:1, below ${floor}`);

const site = await serve('dist-test');
const INDEX = `${site.origin}/index.html?test`;

const settle = page =>
  page.eval('return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');

/*
 * A live board of a known shape. The rules sheet opens unasked on a first
 * visit and the board arrives covered, so both have to be got out of the way
 * before anything on screen is the colour it will be during play.
 */
const play = async (page, game) => {
  const hook = `window.__${game}`;
  for (let i = 0; i < 100; i++) {
    if (await page.eval(`return !!${hook} && !!${hook}.state.puzzle`)) break;
    await sleep(50);
  }
  ok(await page.eval(`return !!${hook}`), `${game}: the test hooks never appeared`);
  if (await page.eval("return !!document.getElementById('rules')")) {
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(200);
  }
  /*
   * Uncover without paying for the count-in. Generation runs in a worker and a
   * board that lands after the uncover puts the gate straight back, so this
   * asks repeatedly and only believes an uncover that survives a beat.
   */
  let playing = false;
  for (let round = 0; round < 30 && !playing; round++) {
    await page.eval(`${hook}.reveal(); return 1`);
    await sleep(120);
    if (!await page.eval(`return ${hook}.state.phase === 'playing'`)) continue;
    await sleep(250);
    playing = await page.eval(`return ${hook}.state.phase === 'playing'`);
  }
  ok(playing, `${game}: the board never came out from under the ready gate`);
  await settle(page);
};

// The nearest painted background behind an element -- what its text is actually
// read against, which for a banner is the panel and not the page.
const BG_OF = `
  const bgOf = el => {
    for (let n = el; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\\(0, 0, 0, 0\\)/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor;
  };`;

// --- the palette says the same thing whichever route reaches light ----------
section('the palette says the same thing whichever route reaches light');
/*
 * render.js checks this over a hard-coded list of twelve tokens, so a token
 * added to one light block and forgotten in the other stays invisible to it --
 * and only pinned-light users would ever see the difference. Derive the list
 * from the stylesheet instead, so new tokens are covered the day they land.
 */
{
  const page = await launch();
  await page.setup({ scheme: 'light', width: 520, height: 900 });
  await page.goto(INDEX);
  const tokens = await page.eval(`
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walk = list => {
        for (const rule of list) {
          if (rule.cssRules) walk(rule.cssRules);
          if (!rule.style || !/:root/.test(rule.selectorText ?? '')) continue;
          for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
        }
      };
      walk(rules);
    }
    return [...names];`);
  ok(tokens.length >= 15, `only ${tokens.length} palette tokens found; the sheet was not read`);
  const read = `
    const cs = getComputedStyle(document.documentElement);
    return ${JSON.stringify(tokens)}.map(t => cs.getPropertyValue(t).trim());`;
  const viaMedia = await page.eval(read);
  const viaPin = await page.eval(
    `document.documentElement.setAttribute('data-theme','light'); ` + read);
  tokens.forEach((token, i) => {
    ok(viaMedia[i] !== '', `${token} has no value under system light`);
    ok(viaMedia[i] === viaPin[i],
       `${token} differs by route: system "${viaMedia[i]}" vs pinned "${viaPin[i]}"`);
  });
  await page.close();
}

// --- every state that carries colour is readable, in both themes ------------
section('every state that carries colour is readable, in both themes');
for (const scheme of ['dark', 'light']) {
  const page = await launch();
  await page.setup({ scheme, width: 520, height: 900 });
  await page.goto(`${INDEX}#/zip`);
  await play(page, 'zip');

  // Body text, the baseline -- the one thing render.js already covered.
  const body = await page.eval(`
    const cs = getComputedStyle(document.body);
    return { fg: cs.color, bg: cs.backgroundColor };`);
  at(contrast(body.fg, body.bg), 4.5, `${scheme}: body text`);

  /*
   * The focus ring is a non-text indicator, so 3:1 -- WCAG 2.2 SC 1.4.11. It is
   * drawn outside the control (outline-offset), which puts it against the page,
   * but it also runs alongside the control's own fill, so both comparisons have
   * to hold. Tab rather than .focus(): :focus-visible only matches a keyboard.
   */
  let ring = null;
  for (let i = 0; i < 10 && !ring; i++) {
    await page.send('Input.dispatchKeyEvent',
      { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await page.send('Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    ring = await page.eval(`${BG_OF}
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0) return null;
      return {
        tag: el.tagName + (el.id ? '#' + el.id : ''),
        colour: cs.outlineColor,
        own: bgOf(el),
        page: getComputedStyle(document.body).backgroundColor
      };`);
  }
  ok(!!ring, `${scheme}: no focused control ever showed an outline`);
  if (ring) {
    at(contrast(ring.colour, ring.page), 3, `${scheme}: focus ring on ${ring.tag} vs the page`);
    at(contrast(ring.colour, ring.own), 3, `${scheme}: focus ring on ${ring.tag} vs its own fill`);
  }

  /*
   * The error banner. Revealing is the one failure state reachable on demand,
   * and in daily mode it asks before it obeys -- so the second click is the one
   * that answers "Sure?".
   */
  await page.eval("document.getElementById('revealBtn').click(); return 1");
  await settle(page);
  if (!await page.eval("return /show/.test(document.getElementById('banner').className)")) {
    await page.eval("document.getElementById('revealBtn').click(); return 1");
    await settle(page);
  }
  const bad = await page.eval(`${BG_OF}
    const el = document.getElementById('bannerText');
    return {
      text: el.textContent, shown: document.getElementById('banner').className,
      fg: getComputedStyle(el).color, bg: bgOf(el)
    };`);
  ok(/show/.test(bad.shown) && /Revealed/.test(bad.text),
     `${scheme}: the error banner never appeared (class "${bad.shown}")`);
  at(contrast(bad.fg, bad.bg), 4.5, `${scheme}: error banner text`);

  // Solve it properly for the two colours only a win puts on screen.
  await page.eval('window.__zip.restart(); return 1');
  await page.eval(`
    const z = window.__zip;
    for (const cell of z.state.puzzle.solution) z.step(cell);
    return 1;`);
  await settle(page);
  await sleep(120);
  const won = await page.eval(`${BG_OF}
    const clock = document.getElementById('clock');
    const banner = document.getElementById('bannerText');
    const track = document.querySelector('.progress');
    return {
      solved: window.__zip.state.solved,
      clockClass: clock.className,
      clockFg: getComputedStyle(clock).color, clockBg: bgOf(clock),
      bannerText: banner.textContent,
      bannerFg: getComputedStyle(banner).color, bannerBg: bgOf(banner),
      trackBg: getComputedStyle(track).backgroundColor,
      pageBg: getComputedStyle(document.body).backgroundColor
    };`);
  ok(won.solved && /done/.test(won.clockClass),
     `${scheme}: the board did not finish solved (clock "${won.clockClass}")`);
  ok(/\d:\d\d\.\d/.test(won.bannerText),
     `${scheme}: the win banner reads "${won.bannerText}", not a finishing time`);
  at(contrast(won.clockFg, won.clockBg), 4.5, `${scheme}: solved clock`);
  at(contrast(won.bannerFg, won.bannerBg), 4.5, `${scheme}: win banner text`);
  /*
   * The empty half of the progress bar is not text and carries no state on its
   * own, so 3:1 would be the wrong bar -- but it has to be findable, or the
   * filled half has no extent. Dark's own track sits at 1.38:1; hold light to
   * at least that, which is what "as visible as the theme that worked" means.
   */
  at(contrast(won.trackBg, won.pageBg), 1.35, `${scheme}: empty progress track vs the page`);
  ok(page.consoleErrors.length === 0, `${scheme}: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a narrow phone keeps the controls, the name, and its left edge ---------
section('a narrow phone keeps the controls, the name, and its left edge');
/*
 * The hint line is the only persistent statement of the controls outside the
 * rules sheet -- on Queens it is the only written mention of tapping twice for
 * a queen -- and the wordmark is the only thing naming what you are playing.
 * Both used to be dropped below 380px, which left the narrowest phones with an
 * anonymous header and no controls. They shrink now, and shrinking must not
 * cost the page its left edge: nothing may scroll sideways.
 */
{
  const page = await launch();
  await page.setup({ scheme: 'light', width: 390, height: 900, mobile: true });
  for (const game of ['zip', 'queens']) {
    await page.goto(`${INDEX}#/${game}`);
    await play(page, game);
    for (const width of [320, 360, 390, 430]) {
      await page.send('Emulation.setDeviceMetricsOverride',
        { width, height: 900, deviceScaleFactor: 2, mobile: true });
      await sleep(90);
      const m = await page.eval(`
        const d = document.documentElement;
        const head = document.querySelector('header');
        const title = document.querySelector('.brand-title');
        const hint = document.querySelector('.hint');
        return {
          scrollW: d.scrollWidth, clientW: d.clientWidth,
          headScrollW: head.scrollWidth, headClientW: head.clientWidth,
          titleShown: getComputedStyle(title).display !== 'none',
          titleWidth: title.getBoundingClientRect().width,
          titleText: title.textContent,
          hintShown: getComputedStyle(hint).display !== 'none',
          hintHeight: hint.getBoundingClientRect().height
        };`);
      const where = `${game} at ${width}px`;
      ok(m.scrollW <= m.clientW + 1,
         `${where}: the page scrolls horizontally (${m.scrollW} > ${m.clientW})`);
      ok(m.headScrollW <= m.headClientW + 1,
         `${where}: the header overflows (${m.headScrollW} > ${m.headClientW})`);
      ok(m.titleShown && m.titleWidth >= 20,
         `${where}: the title "${m.titleText}" is ${m.titleShown ? Math.round(m.titleWidth) + 'px wide' : 'hidden'}`);
      ok(m.hintShown && m.hintHeight > 10,
         `${where}: the control hint is ${m.hintShown ? 'collapsed' : 'hidden'}`);
    }
  }
  ok(page.consoleErrors.length === 0, `narrow widths: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- a phone on its side keeps the board and the controls on screen ---------
section('a phone on its side keeps the board and the controls on screen');
/*
 * Turning the phone used to end the game. At 844x390 the board ran 180px past
 * the fold and the controls sat another 210px below that, against a 390px
 * viewport -- so finishing a timed puzzle meant scrolling mid-solve, which is
 * the worst thing this app can ask. The ready gate was no better: Start's
 * bottom edge was flush with the viewport and "How to play" was off screen.
 *
 * Fitting is not enough on its own -- a board shrunk to a postage stamp would
 * pass every "is it on screen" question -- so the board's size is checked too.
 */
{
  const page = await launch();
  await page.setup({ scheme: 'dark', width: 844, height: 390, mobile: true });
  for (const game of ['zip', 'queens']) {
    await page.goto(`${INDEX}#/${game}`);
    for (let i = 0; i < 100; i++) {
      if (await page.eval(`return !!(window.__${game} && window.__${game}.state.puzzle)`)) break;
      await sleep(50);
    }
    // The first visit opens the rules over the board; dismiss them the way a
    // thumb now can, which also proves the new button is wired to the close.
    if (await page.eval("return !!document.getElementById('rules')")) {
      const dismiss = await page.eval("return !!document.getElementById('rulesGotIt')");
      ok(dismiss, `${game}: the rules sheet has no reachable dismiss`);
      // Fall back to the corner X if it is missing, so one failure here does
      // not take the landscape measurements down with it.
      await page.eval(
        `document.getElementById('${dismiss ? 'rulesGotIt' : 'rulesClose'}').click(); return 1`);
      await sleep(250);
      ok(await page.eval("return !document.getElementById('rules')"),
         `${game}: the rules did not close`);
    }

    // On the gate, before the clock exists: both of its controls are on screen.
    const gate = await page.eval(`
      const box = id => {
        const el = document.getElementById(id);
        return el ? el.getBoundingClientRect().bottom : null;
      };
      const d = document.scrollingElement;
      return {
        start: box('startBtn'), help: box('gateHelpBtn'),
        vh: innerHeight, scrollH: d.scrollHeight, clientH: d.clientHeight
      };`);
    ok(gate.start !== null && gate.start <= gate.vh,
       `${game} landscape: Start ends at ${Math.round(gate.start)} in a ${gate.vh}px viewport`);
    ok(gate.help !== null && gate.help <= gate.vh,
       `${game} landscape: "How to play" ends at ${Math.round(gate.help)} in a ${gate.vh}px viewport`);
    ok(gate.scrollH <= gate.clientH + 1,
       `${game} landscape: the gate scrolls (${gate.scrollH} > ${gate.clientH})`);

    await play(page, game);

    /*
     * Mid-solve is the measurement that matters. The whole controls row is
     * checked, not just its box: a five-button grid can report a tidy
     * rectangle while its last button hangs off the bottom.
     */
    const m = await page.eval(`
      const d = document.scrollingElement;
      const board = document.getElementById('board').getBoundingClientRect();
      const controls = document.querySelector('.controls').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.controls .btn')]
        .map(b => { const r = b.getBoundingClientRect(); return { id: b.id, bottom: r.bottom, right: r.right }; });
      return {
        board: { top: board.top, bottom: board.bottom, width: board.width, height: board.height },
        controls: { top: controls.top, bottom: controls.bottom },
        buttons,
        vw: innerWidth, vh: innerHeight,
        scrollH: d.scrollHeight, clientH: d.clientHeight,
        scrollW: d.scrollWidth, clientW: d.clientWidth
      };`);
    const where = `${game} landscape`;
    ok(m.board.top >= -1 && m.board.bottom <= m.vh + 1,
       `${where}: the board runs ${Math.round(m.board.top)}..${Math.round(m.board.bottom)} in a ${m.vh}px viewport`);
    ok(m.controls.bottom <= m.vh + 1,
       `${where}: the controls end at ${Math.round(m.controls.bottom)}, ${Math.round(m.controls.bottom - m.vh)}px below the fold`);
    const spilled = m.buttons.filter(b => b.bottom > m.vh + 1 || b.right > m.vw + 1);
    ok(spilled.length === 0,
       `${where}: ${spilled.map(b => b.id).join(', ')} sit outside the viewport`);
    ok(m.scrollH <= m.clientH + 1,
       `${where}: the page scrolls vertically (${m.scrollH} > ${m.clientH})`);
    ok(m.scrollW <= m.clientW + 1,
       `${where}: the page scrolls horizontally (${m.scrollW} > ${m.clientW})`);
    // Fitting by shrinking is not fitting. A 6x6 grid below this is unplayable.
    ok(m.board.width >= 240,
       `${where}: the board shrank to ${Math.round(m.board.width)}px to fit`);
    ok(Math.abs(m.board.width - m.board.height) <= 1,
       `${where}: the board is ${Math.round(m.board.width)}x${Math.round(m.board.height)}, no longer square`);
    // Beside the board, not under it: the point of the whole rearrangement.
    ok(m.controls.top >= m.board.top - 1,
       `${where}: the controls are stacked above the board`);
  }
  ok(page.consoleErrors.length === 0, `landscape: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

// --- the sheet clears the home indicator, and a thumb can reach everything --
section('the sheet clears the home indicator, and a thumb can reach everything');
/*
 * Three things a thumb cares about, on the narrowest phone still in use.
 *
 * The rules sheet is pinned to the bottom of the screen, and a fixed-position
 * element inherits none of the body's safe-area padding -- so its last lines
 * sat under the home indicator and inside the swipe that dismisses the app.
 * env() reads as 0 in a headless browser, so the inset itself cannot be
 * measured here; what is checked is that the rule bottom-most in the sheet
 * asks for it at all, plus the fixed part of the padding it adds to.
 *
 * Its only affirmative dismissal was a 31px X in the top-right corner, the
 * hardest point on a one-handed phone to reach. And the header icons are 34px
 * boxes, which clears WCAG 2.5.8 AA and neither AAA nor Apple's 44px -- so
 * they carry hit slop, which must reach without ever overlapping a neighbour.
 */
{
  const page = await launch();
  await page.setup({ scheme: 'light', width: 320, height: 568, mobile: true });
  await page.goto(`${INDEX}#/zip`);
  await sleep(1400);
  ok(await page.eval("return !!document.getElementById('rules')"),
     'the rules did not open on a first visit');

  const sheet = await page.eval(`
    const foot = document.querySelector('#rules .sheet-foot');
    const body = document.querySelector('#rules .sheet-body');
    const panel = document.querySelector('#rules .sheet-panel');
    const last = foot ?? body;
    /* Which rule actually applies to the bottom of the sheet, read off the
       stylesheet the way the palette check above reads tokens. */
    const asking = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      const walk = list => {
        for (const rule of list) {
          if (rule.cssRules) walk(rule.cssRules);
          if (!rule.style || !rule.selectorText) continue;
          if (!/safe-area-inset-bottom/.test(rule.cssText)) continue;
          try { if (last.matches(rule.selectorText)) asking.push(rule.selectorText); } catch {}
        }
      };
      walk(rules);
    }
    const gotIt = document.getElementById('rulesGotIt');
    const g = gotIt?.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    return {
      hasFoot: !!foot,
      lastClass: last.className,
      asking,
      lastPadBottom: parseFloat(getComputedStyle(last).paddingBottom),
      panelBottom: p.bottom, panelWidth: p.width,
      gotIt: g && { top: g.top, bottom: g.bottom, width: g.width, height: g.height },
      vh: innerHeight
    };`);
  ok(sheet.asking.length > 0,
     `nothing at the bottom of the sheet (.${sheet.lastClass}) asks for env(safe-area-inset-bottom)`);
  ok(sheet.lastPadBottom >= 8,
     `the bottom of the sheet pads only ${sheet.lastPadBottom}px before the inset is added`);

  ok(!!sheet.gotIt, 'the rules sheet has no "Got it" dismiss');
  if (sheet.gotIt) {
    ok(sheet.hasFoot && sheet.gotIt.bottom <= sheet.vh + 1,
       `"Got it" ends at ${Math.round(sheet.gotIt.bottom)} in a ${sheet.vh}px viewport`);
    ok(sheet.gotIt.width >= sheet.panelWidth * 0.8,
       `"Got it" is ${Math.round(sheet.gotIt.width)}px of a ${Math.round(sheet.panelWidth)}px panel, not full width`);
    ok(sheet.gotIt.height >= 44,
       `"Got it" is ${Math.round(sheet.gotIt.height)}px tall, under the 44px a thumb wants`);
    // It has to be the dismissal, not merely a button that looks like one.
    await page.eval("document.getElementById('rulesGotIt').click(); return 1");
    await sleep(250);
    ok(await page.eval("return !document.getElementById('rules')"),
       '"Got it" did not close the rules');
    ok(await page.eval("return getComputedStyle(document.body).overflow !== 'hidden'"),
       'closing with "Got it" left the page behind the sheet locked');
  } else {
    // The checks below read the page underneath, so get the sheet out of the
    // way however this build allows.
    await page.eval("document.getElementById('rulesClose').click(); return 1");
    await sleep(250);
  }

  /*
   * The key list is gated on the pointer, not the width: a 430pt Pro Max is
   * above every width breakpoint and still cannot press U. The row itself
   * stays -- on Queens it is the only standing statement of the touch
   * controls -- and the rules sheet's own <kbd>s stay too, because there
   * "drag" and "tap" are among them.
   */
  for (const width of [320, 390, 430]) {
    await page.send('Emulation.setDeviceMetricsOverride',
      { width, height: 568, deviceScaleFactor: 2, mobile: true });
    await sleep(90);
    const hint = await page.eval(`
      const row = document.querySelector('.hint');
      const keys = [...row.querySelectorAll('kbd')];
      return {
        coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
        shown: getComputedStyle(row).display !== 'none',
        height: row.getBoundingClientRect().height,
        /*
         * Ask whether each cap is actually laid out, not what its own display
         * says. The clause around them is what gets hidden, and a child of a
         * display:none parent keeps its own computed display -- so reading that
         * reports key caps that are nowhere on the screen.
         */
        visibleKeys: keys.filter(k => k.getClientRects().length > 0).length,
        text: row.innerText.replace(/\s+/g, ' ').trim()
      };`);
    ok(hint.coarse, `${width}px: the emulated phone does not report a coarse pointer`);
    ok(hint.shown && hint.height > 10,
       `${width}px: the control hint is ${hint.shown ? 'collapsed' : 'hidden'}`);
    ok(hint.visibleKeys === 0,
       `${width}px: the hint still shows ${hint.visibleKeys} key caps to a touch screen`);
    // Hiding the caps alone used to stranded the words between them.
    ok(!/\b(move|undo|hint|restart|new)\b/.test(hint.text),
       `${width}px: the hint left key words behind: "${hint.text}"`);
    ok(/drag/.test(hint.text),
       `${width}px: the touch guidance went with the keys ("${hint.text}")`);
  }

  // Hit slop: reach beyond the drawn box, and never into a neighbour's.
  for (const width of [320, 360, 390, 430]) {
    await page.send('Emulation.setDeviceMetricsOverride',
      { width, height: 568, deviceScaleFactor: 2, mobile: true });
    await sleep(90);
    const touch = await page.eval(`
      const ids = ['backBtn', 'helpBtn', 'soundBtn', 'themeBtn'];
      const btns = ids.map(i => document.getElementById(i)).filter(Boolean);
      const hit = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return el ? (el.closest('button')?.id ?? el.tagName) : 'nothing';
      };
      const out = { boxes: [], reach: [], stolen: [] };
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        const slop = getComputedStyle(b, '::after');
        const w = parseFloat(slop.width), h = parseFloat(slop.height);
        out.boxes.push({ id: b.id, drawn: r.width, slopW: w, slopH: h });
        // No pseudo-element at all: nothing to probe, and nothing to reach with.
        if (!Number.isFinite(w) || !Number.isFinite(h)) { out.reach.push(b.id + ' (no slop)'); continue; }
        /* One pixel inside the slop, above and below, where no neighbour can
           ever be: that reach must belong to the button itself. */
        if (hit(r.left + r.width / 2, r.top - (h - r.height) / 2 + 1) !== b.id) out.reach.push(b.id + ' above');
        if (hit(r.left + r.width / 2, r.bottom + (h - r.height) / 2 - 1) !== b.id) out.reach.push(b.id + ' below');
      }
      /* Slop that overlaps is worse than no slop: the tap goes to whichever
         box paints last, so a near miss lands on the wrong control silently. */
      const spans = btns.map(b => {
        const r = b.getBoundingClientRect();
        const w = parseFloat(getComputedStyle(b, '::after').width);
        return { id: b.id, left: r.left + r.width / 2 - w / 2, right: r.left + r.width / 2 + w / 2 };
      });
      for (let i = 1; i < spans.length; i++) {
        if (spans[i].left < spans[i - 1].right - 0.5) out.stolen.push(spans[i - 1].id + '/' + spans[i].id);
      }
      return out;`);
    const where = `${width}px`;
    ok(touch.boxes.length >= 3, `${where}: only ${touch.boxes.length} header icons found`);
    ok(touch.reach.length === 0,
       `${where}: hit slop does not answer for ${touch.reach.join(', ')}`);
    ok(touch.stolen.length === 0,
       `${where}: hit slop overlaps between ${touch.stolen.join(', ')}`);
    for (const b of touch.boxes) {
      ok(b.slopH >= 40,
         `${where}: ${b.id} is ${Math.round(b.drawn)}px drawn and only ${Math.round(b.slopH)}px tall to a thumb`);
      ok(b.slopW > b.drawn + 2,
         `${where}: ${b.id} has no horizontal slop (${Math.round(b.slopW)} vs ${Math.round(b.drawn)})`);
    }
  }
  ok(page.consoleErrors.length === 0, `sheet and targets: ${page.consoleErrors.join(' | ')}`);
  await page.close();
}

await site.close();
console.log(`contrast  ${checks} assertions, ${failures} failures`);
process.exit(failures ? 1 : 0);
