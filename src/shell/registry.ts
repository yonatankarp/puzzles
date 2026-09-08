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
  /*
   * What the board itself says to a screen reader: the aim, then the keys that
   * actually work on it. The shared board frame reads this rather than a
   * literal, because one frame serves both games and the literal was Zip's.
   * It lives here and not in the snapshot because it is a fact about the game,
   * not about the run -- it does not change between two frames.
   */
  help: string;
  rules: HowToStep[];
  controls: Array<{ keys: string; what: string }>;
  /** Things that are true but not obvious. */
  tips: string[];
}

export interface GameMeta {
  id: string;
  /*
   * Three letters, for the front of a board code. Short because the code gets
   * read aloud and typed, and fixed forever once published: changing it would
   * break every code already written down.
   */
  code: string;
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
    code: 'ZIP',
    name: 'Zip',
    tagline: 'One path through every square, in order.',
    rules: 'Draw a single line that visits every square exactly once, starting at 1 and taking the numbers in order without crossing a wall.',
    accent: '#4d8bff',
    ready: true,
    howTo: {
      goal: 'Draw one line that fills the whole board and passes through the numbers in order.',
      help: 'Draw one line through every square, starting at number 1 and taking the numbers in order, without crossing a wall. Use the arrow keys to extend the line, U to undo a square, H for a hint, R to restart.',
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
        { keys: 'R', what: 'Clear the board (the clock keeps running)' },
        { keys: 'code', what: 'The code under the board names this exact puzzle. Share it to set someone the same board, or paste one you were sent.' }
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
    code: 'QNS',
    name: 'Queens',
    tagline: 'One per row, column and colour — none touching.',
    rules: 'Place one queen in every row, every column and every colour region, with no two queens touching, not even diagonally.',
    accent: '#f5b544',
    ready: true,
    howTo: {
      goal: 'Place exactly one queen in every row, every column and every colour region.',
      help: 'Place one queen in every row, every column and every colour region, with no two queens touching. Use the arrow keys to move around the grid, space or enter to take a square from empty to crossed off to a queen, X to cross a square off, U to take back the last queen, H for a hint, R to restart.',
      rules: [
        { what: 'One queen per row and per column.' },
        { what: 'One queen per colour region.', detail: 'There are exactly as many regions as rows.' },
        { what: 'No two queens may touch.', detail: 'Not side by side, and not corner to corner either.' }
      ],
      controls: [
        { keys: 'tap', what: 'Once to mark a square you have ruled out, again for a queen, again to clear.' },
        { keys: 'drag', what: 'From an empty square, cross off a whole row or column in one go — queens already placed are left alone.' },
        { keys: '← ↑ ↓ →', what: 'Move the cursor around the grid.' },
        { keys: 'space', what: 'Cycle the square under the cursor, the same way a tap does.' },
        { keys: 'X', what: 'Cross the square under the cursor off, or take the cross back.' },
        { keys: 'U', what: 'Take back the last queen' },
        { keys: 'H', what: 'Hint — places the next queen' },
        { keys: 'R', what: 'Clear the board (the clock keeps running)' },
        { keys: 'code', what: 'The code under the board names this exact puzzle. Share it to set someone the same board, or paste one you were sent.' }
      ],
      tips: [
        'Queens do not attack along whole diagonals here — only the eight squares immediately around them.',
        'Clashing queens are outlined in red, so you can see what is wrong rather than only that something is.',
        'A region squeezed into a single row or column decides that row or column for you.',
        'Placing a queen rules out its whole row and column — drag along them rather than tapping each square.'
      ]
    }
  }
,
  {
    id: 'patch',
    code: 'PCH',
    name: 'Patch',
    tagline: 'A box around every number, covering the board.',
    rules: 'Draw a rectangle around every number, covering exactly as many squares as the number says, until the whole board is covered.',
    accent: '#f5b544',
    ready: true,
    howTo: {
      help: 'Draw a rectangle around every number. The rectangle must cover exactly as many squares as the number says, and hold that one number and no other. When the rectangles cover the whole board without overlapping, the puzzle is done. Drag a box on the board to draw one, tap a patch to take it back. With the keyboard, arrows move, enter sets a corner, arrows stretch the box and enter again draws it; U undoes, H gives a hint, R restarts.',
      goal: 'Draw a rectangle around every number until the whole board is covered.',
      rules: [
        { what: 'Every number gets a rectangle drawn around it.', detail: 'One number per rectangle — never two, never none.' },
        { what: 'The rectangle covers exactly as many squares as the number says.', detail: 'A 6 can be 1×6, 2×3, 3×2 or 6×1. Which one is the puzzle.' },
        { what: 'The rectangles cover the whole board and never overlap.', detail: 'No square left bare, and none covered twice.' }
      ],
      controls: [
        { keys: 'drag', what: 'Draw a box from one corner to the other.' },
        { keys: 'tap', what: 'A tap inside a finished patch takes it back.' },
        { keys: '← ↑ ↓ →', what: 'Move around the board' },
        { keys: 'enter', what: 'Set one corner, stretch with the arrows, then enter again to draw it' },
        { keys: 'U', what: 'Take back the last patch' },
        { keys: 'H', what: 'Hint — draws one patch correctly' },
        { keys: 'R', what: 'Clear the board (the clock keeps running)' },
        { keys: 'code', what: 'The code under the board names this exact puzzle. Share it to set someone the same board, or paste one you were sent.' }
      ],
      tips: [
        'Start with the numbers that can only go one way: a 5 or a 7 has to be a single straight strip, and near an edge there is usually only one place to put it.',
        'A square in a corner can only be reached by a few numbers. Work out which, and that number is settled.',
        'Drawing a box over patches you have already made rubs them out, so you can correct yourself without undoing first.'
      ]
    }
  },
  {
    id: 'lamplight',
    code: 'LMP',
    name: 'Lamplight',
    tagline: 'Every dark square lit, and none lit twice.',
    rules: 'Turn each lamp so its beam lights every dark square on the board exactly once.',
    accent: '#f5b544',
    ready: true,
    howTo: {
      help: 'Every lamp shines one way — up, down, left or right — and its beam runs until it meets a wall, another lamp, or the edge. Turn the lamps so every square that is not a wall ends up lit, and none is lit twice. Drag out of a lamp to aim it, or tap it to turn it round the compass. With the keyboard, space steps between lamps, the arrows shine the one you are on, enter turns it; U undoes, H gives a hint, R restarts.',
      goal: 'Turn every lamp so the whole room is lit, with no square lit twice.',
      rules: [
        { what: 'Every lamp shines one way.', detail: 'Up, down, left or right — never diagonally.' },
        { what: 'Its beam runs until something stops it.', detail: 'A wall, another lamp, or the edge of the board. Nothing is hidden: you can see how far a beam will reach before you commit to it.' },
        { what: 'Every dark square must be lit, and none lit twice.', detail: 'Walls are not lit at all. Two beams crossing the same square glow red.' }
      ],
      controls: [
        { keys: 'drag', what: 'Out of a lamp, the way you want it to shine.' },
        { keys: 'tap', what: 'Turns a lamp clockwise; one tap past the last way round puts it out.' },
        { keys: 'space', what: 'Step to the next lamp' },
        { keys: '← ↑ ↓ →', what: 'Shine the lamp you are on that way' },
        { keys: 'enter', what: 'Turn the lamp you are on round the compass' },
        { keys: 'U', what: 'Put out the lamp you turned last' },
        { keys: 'H', what: 'Hint — aims one lamp correctly' },
        { keys: 'R', what: 'Put every lamp out (the clock keeps running)' },
        { keys: 'code', what: 'The code under the board names this exact puzzle. Share it to set someone the same board, or paste one you were sent.' }
      ],
      tips: [
        'A lamp boxed in on three sides has only one way to shine. Those are the way into every board.',
        'Look at the dark squares, not only at the lamps: a square in a corner can often be reached by just one lamp, and that settles it.',
        'A wall behind a lamp is as useful as a wall in front of it — it is what stops somebody else’s beam arriving.'
      ]
    }
  }
];

export const gameById = (id: string): GameMeta | undefined => GAMES.find(g => g.id === id);
export const gameByCode = (code: string): GameMeta | undefined =>
  GAMES.find(g => g.code === code.toUpperCase());
