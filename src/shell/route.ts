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
 *   #/s/ZIP-M-109YCCQK     one exact board, for playing someone else -- the
 *                         code names the game and the difficulty as well as
 *                         the seed, so it needs no path around it
 *   #changelog            what has changed, over whatever is underneath
 *
 * The tier in a seed link is not decoration. The generator is entered per tier,
 * so the same number is a different puzzle at every difficulty; a link carrying
 * only the number would hand two people different boards while telling both of
 * them they were racing the same one.
 */
import { gameById } from './registry.ts';
import { decodeBoardCode, decodeSeed } from './seed.ts';
import { gameByCode } from './registry.ts';

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

  /*
   * A board code carries its own game, so it sits at the root rather than under
   * one. An unreadable code lands on the index rather than guessing a game.
   */
  const coded = /^\/s\/([A-Za-z0-9-]+)\/?$/.exec(raw);
  if (coded) {
    const board = decodeBoardCode(coded[1]!);
    if (board) {
      const meta = gameByCode(board.game);
      /*
       * A daily code names a board but does not open one -- replaying it would
       * let someone learn today's daily and then record a time for it. The link
       * still goes to that game, where its daily is the board in question.
       */
      if (meta && board.tier === 'daily') return { game: meta.id, overlay: null, seed: null };
      if (meta) return { game: meta.id, overlay: null, seed: { tier: board.tier, seed: board.seed } };
    }
    /*
     * The code did not survive its check character, but its first field still
     * names a game readably. Open that game rather than dumping someone at the
     * index: they know what they were sent, and the board code is on screen for
     * them to compare against.
     */
    const prefix = /^([A-Za-z]{2,4})-/.exec(coded[1]!);
    const guess = prefix && gameByCode(prefix[1]!);
    return guess ? { game: guess.id, overlay: null, seed: null } : NOWHERE;
  }

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
export const codeHref = (code: string) => `#/s/${code}`;
export const indexHref = '#/';
