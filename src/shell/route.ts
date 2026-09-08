/*
 * Routing on the fragment, not the path: a static host serves one file, and a
 * fragment keeps every view linkable and the Back button working without a
 * server rewrite or a second HTML entry point.
 *
 *   #/                    the index
 *   #/zip                 a game
 *   #/zip/help            how to play that game -- part of the game's own
 *                         address, so the link still works for someone
 *                         opening it cold
 *   #/zip/s/medium/1Z141Z4  one exact board, for playing someone else
 *   #changelog            what has changed, over whatever is underneath
 *
 * The tier in a seed link is not decoration. The generator is entered per tier,
 * so the same number is a different puzzle at every difficulty; a link carrying
 * only the number would hand two people different boards while telling both of
 * them they were racing the same one.
 */
import { gameById } from './registry.ts';
import { decodeSeed, encodeSeed } from './seed.ts';

export type Overlay = 'changelog' | 'help' | null;

export interface SeedRoute {
  tier: string;
  seed: number;
}

export interface Route {
  game: string | null;
  overlay: Overlay;
  seed: SeedRoute | null;
}

/** Remembered so an overlay can open over a game without losing it. */
let lastGame: string | null = null;
export function rememberGame(id: string | null): void { lastGame = id; }

const NOWHERE: Route = { game: null, overlay: null, seed: null };

export function parseRoute(hash: string = location.hash): Route {
  const raw = hash.replace(/^#/, '');
  if (raw === 'changelog') return { game: lastGame, overlay: 'changelog', seed: null };

  const match = /^\/([a-z0-9-]+)(?:\/(.*))?$/i.exec(raw);
  if (!match) return NOWHERE;

  /*
   * An unknown game used to fall through as a game anyway: it marked its rules
   * as seen, pushed a help entry nobody could return from, and then rendered
   * the index under a URL naming a game that does not exist. A mistyped seed
   * link is the easiest way to reach that, so the name is checked here.
   */
  const game = match[1]!.toLowerCase();
  if (!gameById(game)) return NOWHERE;

  const rest = (match[2] ?? '').replace(/\/$/, '');
  if (rest === '') return { game, overlay: null, seed: null };
  if (rest.toLowerCase() === 'help') return { game, overlay: 'help', seed: null };

  const seeded = /^s\/([a-z]+)\/([0-9a-z]+)$/i.exec(rest);
  const seed = seeded ? decodeSeed(seeded[2]!) : null;
  /*
   * Anything else under a game that does exist still opens that game. A seed
   * someone fat-fingered should leave you on the board you were asking for,
   * not back at the index wondering what you did wrong.
   */
  if (!seeded || seed === null) return { game, overlay: null, seed: null };
  return { game, overlay: null, seed: { tier: seeded[1]!.toLowerCase(), seed } };
}

export const gameHref = (id: string) => `#/${id}`;
export const helpHref = (id: string) => `#/${id}/help`;
export const seedHref = (id: string, tier: string, seed: number) =>
  `#/${id}/s/${tier}/${encodeSeed(seed)}`;
export const indexHref = '#/';
