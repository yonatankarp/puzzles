/*
 * The games in the collection. Everything the index shows comes from here, the
 * router matches on `id`, and each game's rules are written once and used both
 * on the card and in the how-to-play sheet.
 */
export interface HowToStep {
  /** A short imperative: the thing you do. */
  what: string;
  /** Why it matters, or the catch. */
  detail?: string;
}

export interface HowTo {
  /** The whole puzzle in one sentence. */
  goal: string;
  rules: HowToStep[];
  controls: Array<{ keys: string; what: string }>;
  /** Things that are true but not obvious. */
  tips: string[];
}

export interface GameMeta {
  id: string;
  name: string;
  tagline: string;
  /** One sentence, for the index card. */
  rules: string;
  accent: string;
  ready: boolean;
  howTo: HowTo;
}

export const GAMES: GameMeta[] = [
  {
    id: 'zip',
    name: 'Zip',
    tagline: 'One path through every square, in order.',
    rules: 'Draw a single line that visits every square exactly once, starting at 1 and taking the numbers in order without crossing a wall.',
    accent: '#4d8bff',
    ready: true,
    howTo: {
      goal: 'Draw one line that fills the whole board and passes through the numbers in order.',
      rules: [
        { what: 'Start at 1 and finish on the highest number.' },
        { what: 'Visit every square exactly once.', detail: 'No square may be left empty, and none may be crossed twice.' },
        { what: 'Reach the numbers in order.', detail: 'You cannot enter 3 before you have been through 2.' },
        { what: 'Never cross a wall.', detail: 'The thick bars between squares are closed.' }
      ],
      controls: [
        { keys: 'drag', what: 'Draw from 1. The line follows your finger.' },
        { keys: 'drag back', what: 'Retrace over the previous square to take a step back.' },
        { keys: '← ↑ ↓ →', what: 'Extend the line one square.' },
        { keys: 'U', what: 'Undo one square' },
        { keys: 'H', what: 'Hint — points at the next move' },
        { keys: 'R', what: 'Clear the board (the clock keeps running)' }
      ],
      tips: [
        'The line only goes back the way it came. Touching an earlier part of it does nothing, so a stray movement cannot wipe your work.',
        'Its colour shifts as the board fills, and the number you are heading for is ringed in the colour the line will be when it arrives.',
        'Corners and dead ends are the giveaway: a square with only one way in and one way out has its route decided already.'
      ]
    }
  },
  {
    id: 'queens',
    name: 'Queens',
    tagline: 'One per row, column and colour — none touching.',
    rules: 'Place one queen in every row, every column and every colour region, with no two queens touching, not even diagonally.',
    accent: '#f5b544',
    ready: true,
    howTo: {
      goal: 'Place exactly one queen in every row, every column and every colour region.',
      rules: [
        { what: 'One queen per row and per column.' },
        { what: 'One queen per colour region.', detail: 'There are exactly as many regions as rows.' },
        { what: 'No two queens may touch.', detail: 'Not side by side, and not corner to corner either.' }
      ],
      controls: [
        { keys: 'tap', what: 'Once to mark a square you have ruled out, again for a queen, again to clear.' },
        { keys: 'U', what: 'Take back the last queen' },
        { keys: 'H', what: 'Hint — places the next queen' },
        { keys: 'R', what: 'Clear the board (the clock keeps running)' }
      ],
      tips: [
        'Queens do not attack along whole diagonals here — only the eight squares immediately around them.',
        'Clashing queens are outlined in red, so you can see what is wrong rather than only that something is.',
        'A region squeezed into a single row or column decides that row or column for you.'
      ]
    }
  }
];

export const gameById = (id: string): GameMeta | undefined => GAMES.find(g => g.id === id);
