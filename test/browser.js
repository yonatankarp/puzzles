/*
 * Minimal Chrome DevTools Protocol driver -- no dependencies, no Puppeteer.
 * Launches headless Chrome, connects over the built-in WebSocket, and exposes
 * just enough to load the page, emulate a viewport and colour scheme, dispatch
 * real input, read the DOM, and capture screenshots.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Look where Chrome actually lives on a dev Mac and on a CI runner, so the
// browser tests run in both without configuration.
const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium'
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}
const CHROME = findChrome();

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function launch({ autoplay = 'relaxed' } = {}) {
  if (!CHROME) throw new Error('no Chrome found; tried:\n  ' + CANDIDATES.join('\n  '));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-cdp-'));
  const proc = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--no-sandbox', '--disable-dev-shm-usage',      // CI runners need both
    ...(autoplay === 'relaxed' ? ['--autoplay-policy=no-user-gesture-required'] : []),
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  // Port 0 means "pick a free one"; Chrome writes the choice into the profile.
  // Fixed ports let a run silently attach to a browser a previous run left
  // behind, inheriting its console history.
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port = null;
  /*
   * Wait on Chrome being alive, not on a stopwatch. The old bound was a flat
   * fifteen seconds, which is generous on this machine and not always enough on
   * a cold CI runner -- so the suite went red with "never reported a debugging
   * port" on a browser that was merely slow to start, and a false red on the
   * check that gates a merge is worse than a slow one. It also sat out the full
   * count when Chrome had already exited, which is the one case worth failing
   * fast on: if the process is gone, no port is coming.
   */
  for (let i = 0; i < 600 && port === null; i++) {
    await sleep(100);
    try {
      const line = fs.readFileSync(portFile, 'utf8').split('\n')[0];
      if (line) port = parseInt(line, 10);
    } catch { /* not written yet */ }
    if (port === null && proc.exitCode !== null) break;
  }
  if (!port) {
    proc.kill();
    throw new Error(proc.exitCode !== null
      ? `Chrome exited with code ${proc.exitCode} before reporting a debugging port`
      : 'Chrome never reported a debugging port');
  }

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(100);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error('Chrome did not expose a debug target'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  function errorText(msg) {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      return (d.exception && d.exception.description) || d.text;
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      return msg.params.entry.text;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      return msg.params.args.map(a => (a.value != null ? a.value : a.description)).join(' ');
    }
    return null;
  }

  let id = 0;
  const collected = [];
  const pending = new Map();
  const events = [];
  const waiters = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (p) (msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result));
    } else {
      events.push(msg);
      var err = errorText(msg);
      if (err) collected.push(err);
      for (const w of waiters.splice(0)) w(msg);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  const page = {
    send, events,
    get consoleErrors() { return collected; },
    clearErrors() { collected.length = 0; },
    async close() { ws.close(); proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} },

    async setup({ width = 560, height = 960, mobile = false, scheme = 'light',
                  reducedMotion = false, deviceScaleFactor = 2 } = {}) {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor, mobile
      });
      await send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: scheme },
          { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }
        ]
      });
      if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      // Clipboard reads and writes require a focused document, and a headless
      // tab is not focused by default.
      await send('Page.bringToFront').catch(() => {});
    },

    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(600);
    },

    /*
     * A real reload. Navigating to a URL that differs only by fragment is a
     * same-document navigation -- the document is never re-created, so anything
     * written to storage first would not be re-read. Tests that mean "reload"
     * have to say so.
     */
    async reload() {
      await send('Page.reload', { ignoreCache: false });
      await sleep(700);
    },

    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(async function(){ ${expr} })()`,
        returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    },

    async mouse(type, x, y) {
      await send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1, pointerType: 'mouse'
      });
    },

    async drag(points) {
      await page.mouse('mousePressed', points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) await page.mouse('mouseMoved', points[i].x, points[i].y);
      await page.mouse('mouseReleased', points[points.length - 1].x, points[points.length - 1].y);
    },

    /*
     * A finger, not a mouse. Needs setup({ mobile: true }), which turns on touch
     * emulation -- without it these dispatch into a page that has no touch at all.
     */
    async touchDrag(points) {
      const at = p => [{ x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 }];
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(points[0]) });
      for (let i = 1; i < points.length; i++) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(points[i]) });
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },

    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    }
  };
  return page;
}


