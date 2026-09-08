/*
 * The games in the collection. Everything the index page shows comes from here,
 * and the router matches on `id`.
 */
export interface GameMeta {
  id: string;
  name: string;
  /** One line for the index card. */
  tagline: string;
  /** The rule that defines the puzzle, in a sentence. */
  rules: string;
  /** Accent used on the card and in the game's own chrome. */
  accent: string;
  /** Whether it is playable yet — the index shows the rest as coming. */
  ready: boolean;
}

export const GAMES: GameMeta[] = [
  {
    id: 'zip',
    name: 'Zip',
    tagline: 'One path through every square, in order.',
    rules: 'Draw a single line that visits every square exactly once, starting at 1 and taking the numbers in order without crossing a wall.',
    accent: '#4d8bff',
    ready: true
  },
  {
    id: 'queens',
    name: 'Queens',
    tagline: 'One per row, column and colour — none touching.',
    rules: 'Place one queen in every row, every column and every colour region, with no two queens touching, not even diagonally.',
    accent: '#f5b544',
    ready: true
  }
];

export const gameById = (id: string): GameMeta | undefined => GAMES.find(g => g.id === id);
