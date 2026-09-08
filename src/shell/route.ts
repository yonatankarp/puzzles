/*
 * Routing on the fragment, not the path: a static host serves one file, and a
 * fragment keeps every view linkable and the Back button working without a
 * server rewrite or a second HTML entry point.
 *
 *   #/            the index
 *   #/zip         a game
 *   #changelog    the changelog, over whatever is underneath
 */
export interface Route {
  game: string | null;
  changelog: boolean;
}

export function parseRoute(hash: string = location.hash): Route {
  const raw = hash.replace(/^#/, '');
  if (raw === 'changelog') return { game: currentGame(), changelog: true };
  const match = /^\/([a-z0-9-]+)/.exec(raw);
  return { game: match ? match[1]! : null, changelog: false };
}

/** Remembered so #changelog can be opened over a game without losing it. */
let lastGame: string | null = null;
function currentGame(): string | null { return lastGame; }
export function rememberGame(id: string | null): void { lastGame = id; }

export const gameHref = (id: string) => `#/${id}`;
export const indexHref = '#/';
