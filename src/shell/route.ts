/*
 * Routing on the fragment, not the path: a static host serves one file, and a
 * fragment keeps every view linkable and the Back button working without a
 * server rewrite or a second HTML entry point.
 *
 *   #/            the index
 *   #/zip         a game
 *   #/zip/help    how to play that game -- part of the game's own address, so
 *                 the link still works for someone opening it cold
 *   #changelog    what has changed, over whatever is underneath
 */
export type Overlay = 'changelog' | 'help' | null;

export interface Route {
  game: string | null;
  overlay: Overlay;
}

/** Remembered so an overlay can open over a game without losing it. */
let lastGame: string | null = null;
export function rememberGame(id: string | null): void { lastGame = id; }

export function parseRoute(hash: string = location.hash): Route {
  const raw = hash.replace(/^#/, '');
  if (raw === 'changelog') return { game: lastGame, overlay: 'changelog' };
  const match = /^\/([a-z0-9-]+)(?:\/(help))?/.exec(raw);
  if (!match) return { game: null, overlay: null };
  return { game: match[1]!, overlay: match[2] === 'help' ? 'help' : null };
}

export const gameHref = (id: string) => `#/${id}`;
export const helpHref = (id: string) => `#/${id}/help`;
export const indexHref = '#/';
