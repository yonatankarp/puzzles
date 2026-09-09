/*
 * The collection as data: every game distinct, and distinct in the ways a
 * player actually tells them apart.
 *
 * This exists because of a failure that no other suite could have caught.
 * Patch and Lamplight were each added by copying the entry above them, accent
 * included, so for two releases three of the four cards were drawn in the same
 * amber. Nothing was broken -- every card looked right on its own, every test
 * passed -- and the index simply stopped saying which game was which.
 *
 * Usage: node test/registry.js
 */
import { GAMES, gameByCode, gameById } from '../src/shell/registry.ts';

let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

/*
 * Distance between two colours, judged the way an eye judges it rather than the
 * way a byte does. Plain RGB distance calls #f5b544 and #3ddc97 further apart
 * than #4d8bff and #c08bff, which is the opposite of what you see, so this goes
 * through OKLab -- near enough perceptually uniform that one threshold means
 * the same thing everywhere in the space.
 */
const srgb = hex => [1, 3, 5].map(i => {
  const c = parseInt(hex.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function oklab(hex) {
  const [r, g, b] = srgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  ];
}

const distance = (a, b) => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/*
 * How far apart two accents have to be. Not a round number: it is under the
 * closest pair the collection actually ships and comfortably over "the same
 * colour twice", so it fails the copy-paste it exists to catch and does not
 * fail a deliberate palette.
 */
const MIN_DISTANCE = 0.12;

ok(GAMES.length > 0, 'the collection is empty');

// --- each game is its own -----------------------------------------------------
for (const field of ['id', 'code', 'name', 'accent']) {
  const seen = new Map();
  for (const game of GAMES) {
    const value = game[field];
    ok(!seen.has(value),
       `${game.id} and ${seen.get(value)} share the same ${field} "${value}"`);
    seen.set(value, game.id);
  }
}

// --- and looks it -------------------------------------------------------------
{
  const pairs = [];
  for (let i = 0; i < GAMES.length; i++) {
    for (let j = i + 1; j < GAMES.length; j++) {
      const a = GAMES[i];
      const b = GAMES[j];
      ok(/^#[0-9a-f]{6}$/i.test(a.accent), `${a.id} has accent "${a.accent}"`);
      const d = distance(a.accent, b.accent);
      pairs.push({ a: a.id, b: b.id, d });
      ok(d >= MIN_DISTANCE,
         `${a.id} (${a.accent}) and ${b.id} (${b.accent}) are ${d.toFixed(3)} apart, ` +
         `under the ${MIN_DISTANCE} it takes to tell two cards apart`);
    }
  }
  const closest = pairs.sort((x, y) => x.d - y.d)[0];
  console.log(`registry  closest pair: ${closest.a}/${closest.b} at ${closest.d.toFixed(3)} ` +
              `(floor ${MIN_DISTANCE})`);
}

// --- the three letters on the front of every board code -----------------------
for (const game of GAMES) {
  ok(/^[A-Z]{3}$/.test(game.code), `${game.id} has code "${game.code}", not three capitals`);
  ok(gameByCode(game.code)?.id === game.id, `${game.code} does not resolve back to ${game.id}`);
  ok(gameByCode(game.code.toLowerCase())?.id === game.id, `${game.code} does not resolve lower-cased`);
  ok(gameById(game.id)?.code === game.code, `${game.id} does not resolve back to ${game.code}`);
}

// --- and each one explains itself ---------------------------------------------
for (const game of GAMES) {
  const { howTo } = game;
  ok(game.tagline.length > 10 && game.tagline.length < 60,
     `${game.id} tagline is ${game.tagline.length} characters`);
  ok(game.rules.length > 40, `${game.id} has a one-line rule of ${game.rules.length} characters`);
  ok(howTo.goal.length > 20, `${game.id} has no goal worth reading`);
  // The board's accessible description is the only instructions a screen
  // reader gets, and one frame serves every game -- so it cannot be missing.
  ok(howTo.help.length > 60, `${game.id} has no board description for a screen reader`);
  ok(howTo.rules.length >= 2, `${game.id} lists ${howTo.rules.length} rules`);
  ok(howTo.controls.length >= 3, `${game.id} lists ${howTo.controls.length} controls`);
  ok(howTo.tips.length >= 2, `${game.id} offers ${howTo.tips.length} tips`);
  ok(howTo.controls.every(c => c.keys && c.what), `${game.id} has a control with a missing half`);
  ok(howTo.rules.every(r => r.what), `${game.id} has a rule with nothing in it`);
}

console.log(failures === 0
  ? `registry  ${checks} assertions, 0 failures`
  : `registry  ${checks} assertions, ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
