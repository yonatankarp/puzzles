/*
 * Every board is generated from one 32-bit number, so two people who hold the
 * same number are playing the same board -- which is the whole of head-to-head
 * here. That number gets read aloud, typed, and pasted into messages, so it
 * travels as short uppercase base36 (1Z141Z4) rather than as ten digits.
 *
 * A seed alone is NOT a board. The generator is entered differently for a daily
 * than for a practice tier, and each tier has its own presets, so seed 4242 at
 * medium and seed 4242 at hard are unrelated puzzles. Anything that carries a
 * seed between people has to carry its tier with it, or both players will think
 * they raced the same board when they did not.
 */
export function encodeSeed(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase();
}

/** Null for anything that is not a seed, so a mistyped link can say so. */
export function decodeSeed(code: string): number | null {
  if (!/^[0-9a-z]{1,7}$/i.test(code)) return null;
  const value = parseInt(code, 36);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return value >>> 0;
}

/*
 * Math.random is seeded from a source we do not control and can repeat across
 * tabs restored together; crypto does not. It matters here only because a
 * repeated seed would look like a bug in the feature itself.
 */
export function randomSeed(): number {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0]! >>> 0;
  }
  return (Math.random() * 0x100000000) >>> 0;
}

/*
 * A board code is the seed plus everything else needed to find the same board:
 * which game, and which difficulty it was generated at. The number alone is not
 * enough -- the generator is entered per tier, so the same number at medium and
 * at expert are different puzzles -- and a code that leaves that out lets two
 * people race different boards believing they match.
 *
 *   ZIP-M-109YCCQK
 *   |   | |       \ check character
 *   |   | \ the seed, base36
 *   |   \ difficulty, or D for a daily board
 *   \ which game
 *
 * The check character is the point of the whole shape. Game and difficulty are
 * validated against the registry and a wrong one is obvious, but a mistyped
 * digit in the seed would otherwise build a perfectly good board that simply is
 * not the one you were sent -- silently, which is the failure this feature
 * exists to prevent.
 */
const TIER_LETTER: Record<string, string> = { easy: 'E', medium: 'M', hard: 'H', expert: 'X' };
const LETTER_TIER: Record<string, string> = { E: 'easy', M: 'medium', H: 'hard', X: 'expert' };

export interface BoardCode {
  /** Registry game code, e.g. ZIP. */
  game: string;
  /** A tier id, or 'daily' for a board built the way the daily is. */
  tier: string;
  seed: number;
}

function checkChar(body: string): string {
  let sum = 0;
  for (const ch of body) sum = (sum * 31 + ch.charCodeAt(0)) % 36;
  return sum.toString(36).toUpperCase();
}

/** Null when a game has a tier with no letter -- a new game must add one. */
export function encodeBoardCode(gameCode: string, tier: string, seed: number): string | null {
  const letter = tier === 'daily' ? 'D' : TIER_LETTER[tier];
  if (!letter) return null;
  const body = `${gameCode.toUpperCase()}-${letter}-${encodeSeed(seed)}`;
  return body + checkChar(body);
}

/*
 * Accepts what people actually paste: the code, a whole link containing it, in
 * any case, with stray spaces. Null for anything that is not a board code,
 * including one whose check character does not match.
 */
export function decodeBoardCode(raw: string): BoardCode | null {
  const text = raw.trim();
  const inLink = /[#/]s\/([A-Za-z0-9-]+)/.exec(text);
  const candidate = (inLink ? inLink[1]! : text).replace(/\s+/g, '').toUpperCase();

  const parts = /^([A-Z]{2,4})-([A-Z])-([0-9A-Z]+)$/.exec(candidate);
  if (!parts) return null;
  const [, game, letter, tail] = parts as unknown as [string, string, string, string];
  if (tail.length < 2) return null;

  const payload = tail.slice(0, -1);
  const body = `${game}-${letter}-${payload}`;
  if (checkChar(body) !== tail.slice(-1)) return null;

  const tier = letter === 'D' ? 'daily' : LETTER_TIER[letter];
  if (!tier) return null;
  const seed = decodeSeed(payload);
  if (seed === null) return null;
  return { game, tier, seed };
}
