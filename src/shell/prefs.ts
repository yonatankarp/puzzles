/*
 * Preferences that belong to the collection rather than to any one game, and
 * the migration that moves them out of Zip's namespace.
 *
 * localStorage is scoped per origin, not per path, so everything saved while
 * the game lived at /zip/ is still readable here. Daily results and best times
 * were already keyed by game id ("zip.daily.251"), so those need nothing; only
 * the app-wide settings were sitting under the same prefix and have to move.
 */
export type Theme = 'system' | 'light' | 'dark';

const MIGRATIONS: Array<[string, string]> = [
  ['zip.theme', 'app.theme'],
  ['zip.sound', 'app.sound'],
  ['zip.seenVersion', 'app.seenVersion']
];

let migrated = false;

export function migrateLegacyPrefs(): void {
  if (migrated) return;
  migrated = true;
  for (const [from, to] of MIGRATIONS) {
    try {
      const value = localStorage.getItem(from);
      if (value !== null && localStorage.getItem(to) === null) localStorage.setItem(to, value);
    } catch { /* storage unavailable; defaults are fine */ }
  }
}

export function read(key: string): string | null {
  migrateLegacyPrefs();
  try { return localStorage.getItem(key); } catch { return null; }
}

export function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* full or blocked */ }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
