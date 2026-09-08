/*
 * The changelog, written for players rather than for me.
 *
 * This file is the single source of truth: CHANGELOG.md at the repo root is
 * generated from it by tools/make-changelog.js, and a test fails if the two
 * fall out of step. Entries correspond to things that actually reached the
 * deployed site, not to every commit.
 */
export type ChangeKind = 'added' | 'changed' | 'fixed';

export interface Change {
  kind: ChangeKind;
  text: string;
}

export interface Release {
  version: string;
  /** ISO date, UTC. */
  date: string;
  /** One line on what the release was about. */
  summary: string;
  changes: Change[];
}

/** Newest first. */
export const RELEASES: Release[] = [
  {
    version: '2.5.0',
    date: '2026-09-08',
    summary: 'Every board now shows the number it was made from, so you can race someone on it.',
    changes: [
      { kind: 'added', text: 'Each board shows the seed it was generated from, on the daily and in practice alike. Two people holding the same seed are playing the same board, which is all it takes to race each other honestly: compare times knowing the puzzle was identical.' },
      { kind: 'added', text: 'Tapping the seed hands over a link that rebuilds that exact board for whoever you send it to — their own difficulty setting does not override it. The link carries the difficulty as well as the number, because the same number is a different puzzle at every difficulty; a link with only the number would have given you both different boards while telling you it was the same one.' },
      { kind: 'fixed', text: 'Tapping one difficulty and then another could leave you on the first. Two boards would be generating at once and the quicker one won, so asking for Medium and then Expert gave you Medium — with the label agreeing, so the only clue was that the puzzle was easier than the one you asked for.' }
    ]
  },
  {
    version: '2.4.0',
    date: '2026-09-08',
    summary: 'Queens tells you when a queen is wrong; the daily stops being one tap from lost.',
    changes: [
      { kind: 'fixed', text: 'A queen that clashed got the same rising chime as one that was right, because the board played the sound before it had checked the rules. A clash now gets its own cue — two short falling notes and a double buzz — so a mistake can no longer be heard as progress. It plays on the sparse sound setting as well as the full one: silence would just read as a tap that never registered.' },
      { kind: 'fixed', text: 'The progress bar counted queens that were clashing, so it went up when you made an illegal move while the board was ringing that same queen in red. Only queens standing legally count now, and the board tells you how many are clashing instead.' },
      { kind: 'fixed', text: 'Pinning the light theme on a machine set to dark left the Queens board in its dark colours, so near-white grid lines sat over dark regions and the grid shouted louder than the region shapes it was drawn under. The regions now follow the theme you actually chose — and follow it the moment you change it, rather than waiting for the next board.' },
      { kind: 'added', text: 'Solving a Queens board is now worth something to look at: the board gives a small pop and the crowns rise one after another in the order you placed them, replaying the run. The crossed-off squares fade away with them — they were your working, not part of the answer.' },
      { kind: 'changed', text: 'A colour region that holds its one queen still steps back, but it no longer takes the whole board down with it. The effect eases off as you get closer to finishing, and starts gentler in dark, where the region colours had been dimmed almost into the board. It still only ever reports what you have already done.' },
      { kind: 'fixed', text: 'With a screen reader, placing a queen read out its square whether the move was sound or hopeless — the red ring that carries the news is the one thing you cannot see. It now says what the new queen clashes with, and where that queen is.' },
      { kind: 'fixed', text: 'The colour regions were painted over the rounded corners of the Queens board, squaring them off.' },
      { kind: 'fixed', text: 'Reveal sat next to Hint, looked identical to it, and gave away the day\u2019s puzzle on a single tap — with the board still covered, so nothing warned you and nothing looked different afterwards. Solving it honestly then recorded nothing at all and broke the streak. It now asks before it answers, and the controls that cannot act on a covered board no longer pretend they can.' },
      { kind: 'fixed', text: 'The best time beside the daily was your practice best at that size, so it sat next to the history\u2019s daily best disagreeing with it, and a daily solve could never move the number printed next to it.' },
      { kind: 'changed', text: 'Coming back to a daily you have already solved no longer offers a Start button that leads nowhere. It shows what you did, how long the streak is, when the next one lands, and where to go in the meantime.' },
      { kind: 'changed', text: 'The daily now says which difficulty it is, rather than only its size — Queens starts you on Hard, which is worth knowing before the clock does.' },
      { kind: 'fixed', text: 'In the light theme the solved clock, the win banner and the error banner were printed in colours that had never been given light values, leaving them close to unreadable on a pale background — the winning time worst of all, at a fifth of the contrast it needed. The keyboard focus ring had the same problem and was near-invisible.' },
      { kind: 'fixed', text: 'Narrow phones dropped both the line describing the controls and the name of the game you were playing. For Queens that line was the only standing mention of dragging to cross a row off. Both now shrink instead of disappearing.' },
      { kind: 'changed', text: 'The mode switch no longer looks like four more difficulty buttons.' },
      { kind: 'added', text: 'Queens can be played from the keyboard. Arrows move a cursor, space marks a square the way tapping does, and X crosses one off. Until now the only key that could place a queen was the hint key, which meant the game could not be finished from the keyboard at all without it counting as a hint.' },
      { kind: 'fixed', text: 'The board told screen-reader users Zip\u2019s rules while they were playing Queens — how to draw a line through numbered squares, on a board with no line and no numbers — and reported progress in squares filled rather than queens. Each game now describes itself.' },
      { kind: 'fixed', text: 'Turning a phone sideways pushed the buttons a screen and a half below the board, so a timed game had to be scrolled while the clock ran. Landscape now puts the board beside the controls, with both fully on screen.' },
      { kind: 'changed', text: 'The row of keyboard shortcuts no longer appears on touch screens, which cannot press any of them. The part about tapping and dragging stays.' },
      { kind: 'changed', text: 'The rules sheet has a Got it button at the bottom, rather than only a small ✕ in the far corner, and no longer runs its last line under the home indicator.' },
      { kind: 'changed', text: 'The small round buttons in the header now take a tap from a little outside their edges. They look the same; they are just harder to miss.' }
    ]
  },
  {
    version: '2.3.0',
    date: '2026-09-08',
    summary: 'Cross off a whole row in Queens with one drag.',
    changes: [
      { kind: 'added', text: 'Queens: drag across the board to cross squares off, instead of tapping them one at a time. Placing a queen rules out an entire row and column, and marking that by hand was the slowest part of a board. A drag that starts on an empty square keeps crossing; queens already placed are left where they are, and a fast flick leaves no gaps behind it.' }
    ]
  },
  {
    version: '2.2.0',
    date: '2026-09-08',
    summary: 'Queens catches up with Zip, and the app stops calling itself Zip.',
    changes: [
      { kind: 'changed', text: 'Queens now shows how far along you are the way Zip does: the progress bar takes the same colour ramp, and a colour region steps back once it holds its one queen. It only ever reports what you have already done — what to do next is still the hint button\u2019s job.' },
      { kind: 'changed', text: 'Queens gained the quiet click that Zip has had. Crossing a square off used to be silent, which left nothing for the sparse sound setting to strip out — so sparse and full sounded identical. Now they differ.' },
      { kind: 'fixed', text: 'Undo in Queens took back the top-left queen rather than the one you just placed, and hinted queens could not be taken back at all.' },
      { kind: 'fixed', text: 'The confetti burst from wherever the first queen happened to sit instead of from the move that finished the board.' },
      { kind: 'fixed', text: 'Installing the collection installed something called Zip, with Zip\u2019s icon: the manifest, icons, offline cache and link-preview card had all been carried over from the single-game site and never renamed.' }
    ]
  },
  {
    version: '2.1.0',
    date: '2026-09-08',
    summary: 'Every game now explains itself.',
    changes: [
      { kind: 'added', text: 'How to play, with the rules, the controls, a worked picture and a few things that are true but not obvious. It appears once the first time you open a game, and lives behind the ? in the header after that.' },
      { kind: 'added', text: "A game's rules have their own address, so you can send someone the rules to the game rather than the rules to nothing." }
    ]
  },
  {
    version: '2.0.0',
    date: '2026-09-08',
    summary: 'Zip is now one of a collection, and Queens has joined it.',
    changes: [
      { kind: 'added', text: 'Queens: place one queen in every row, every column and every colour region, with no two touching — not even diagonally. Daily board, four practice sizes, hints and streaks, same as Zip.' },
      { kind: 'added', text: 'An index listing every game, with today’s result and your streak on each.' },
      { kind: 'changed', text: 'Everything moved to one address. Your Zip streak, best times and daily history came with it.' }
    ]
  },
  {
    version: '1.8.0',
    date: '2026-09-08',
    summary: 'The line is wider, and its colour tells you how far through you are.',
    changes: [
      { kind: 'changed', text: 'The line is thicker, and shifts from blue through violet to pink as the board fills, so how far through you are is readable at a glance. Numbers you have passed through take the line’s colour there.' },
      { kind: 'changed', text: 'The number you are heading for is ringed in the colour the line will be when it arrives — a different colour each time, rather than a fixed highlight.' }
    ]
  },
  {
    version: '1.7.0',
    date: '2026-09-08',
    summary: 'The clock starts when you see the board, not when you first move.',
    changes: [
      { kind: 'changed', text: 'A board now arrives covered, with a Start button and a 3-2-1 count-in. The clock starts the instant it is revealed, so studying a puzzle before the timer runs is no longer free. Space or Enter starts it too.' },
      { kind: 'changed', text: 'A covered board draws nothing but its grid — you can see what size you are getting and no more.' },
      { kind: 'fixed', text: 'Updates now show up straight away. The page was being served from a cache for up to ten minutes after a release, which is how the last one appeared to be missing.' }
    ]
  },
  {
    version: '1.6.0',
    date: '2026-09-08',
    summary: 'The daily is now reproducible for good, and this page exists.',
    changes: [
      { kind: 'added', text: 'This changelog, reachable from the version number below the board.' },
      { kind: 'fixed', text: 'A given day now always produces the same board. It was generated from the same settings the practice tiers use, so retuning those would quietly have changed every past daily.' },
      { kind: 'fixed', text: 'A tab left open across midnight now picks up the new day instead of serving yesterday’s board forever. A run already in progress is left alone to finish.' },
      { kind: 'changed', text: 'Saved results and part-finished runs carry a version, so future changes can migrate them rather than misread them.' }
    ]
  },
  {
    version: '1.5.0',
    date: '2026-09-08',
    summary: 'Playable with a screen reader, installable, and playable offline.',
    changes: [
      { kind: 'added', text: 'Screen-reader support: the board announces every move, and its label carries the live state.' },
      { kind: 'added', text: 'Install it to your home screen and play with no connection.' },
      { kind: 'added', text: 'A 30-day history strip under the daily, with your best and median times.' },
      { kind: 'fixed', text: 'Visible focus rings for keyboard players, and arrow keys no longer hijacked from the rest of the page.' },
      { kind: 'fixed', text: 'Text contrast now meets 4.5:1 throughout — white on the blue button was well below it.' },
      { kind: 'fixed', text: 'Reloading mid-solve no longer hands you a clean board and a fresh clock.' },
      { kind: 'changed', text: 'Puzzle generation moved off the main thread, so building a hard board no longer stutters the one on screen.' }
    ]
  },
  {
    version: '1.4.0',
    date: '2026-09-08',
    summary: 'Sharing that goes where you actually share.',
    changes: [
      { kind: 'added', text: 'Sharing a result opens your phone’s share sheet, and still copies to the clipboard everywhere else.' },
      { kind: 'added', text: 'Pasting the link now shows a preview card with a real board on it.' }
    ]
  },
  {
    version: '1.3.0',
    date: '2026-09-08',
    summary: 'A daily puzzle, and boards that look like the real thing.',
    changes: [
      { kind: 'added', text: 'A daily puzzle: the same board for everyone, with a streak that stands until you miss a day.' },
      { kind: 'added', text: 'Backtracks are counted and reported alongside your time.' },
      { kind: 'added', text: 'Share your result as a line of text.' },
      { kind: 'changed', text: 'Harder puzzles now carry far more numbers and far fewer walls — Expert went from 5 numbers behind 18 walls to 15 numbers behind 6. They are harder as well as denser.' }
    ]
  },
  {
    version: '1.2.0',
    date: '2026-09-07',
    summary: 'Rebuilt underneath; nothing to see.',
    changes: [
      { kind: 'changed', text: 'Rebuilt on React and TypeScript. The board itself is still drawn by hand, because that is what keeps dragging smooth.' }
    ]
  },
  {
    version: '1.1.1',
    date: '2026-09-07',
    summary: 'The clock belongs to the puzzle.',
    changes: [
      { kind: 'fixed', text: 'Restarting no longer resets the timer, so a run going badly cannot be wiped to protect a best time.' }
    ]
  },
  {
    version: '1.1.0',
    date: '2026-09-07',
    summary: 'Stop losing your work, and a proper finish.',
    changes: [
      { kind: 'fixed', text: 'A stray movement across an earlier part of the line no longer erases everything after it. The line only retracts by retracing it.' },
      { kind: 'added', text: 'A solve now sets off a real celebration, and beating your best sets off more of one.' }
    ]
  },
  {
    version: '1.0.1',
    date: '2026-09-07',
    summary: 'Quieter by default.',
    changes: [
      { kind: 'changed', text: 'Sound starts off. The speaker button cycles every step, numbers and wins only, or silent.' }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-09-07',
    summary: 'First release.',
    changes: [
      { kind: 'added', text: 'Four difficulties, every puzzle randomly generated with exactly one solution.' },
      { kind: 'added', text: 'Difficulty measured by how often a solver is genuinely left with a choice, rather than guessed from the number count.' },
      { kind: 'added', text: 'Hints that point out the next move, and reset the board if it can no longer be finished.' },
      { kind: 'added', text: 'Timer, best time per difficulty, and auto-next for continuous practice.' }
    ]
  }
];

export const CURRENT_VERSION = RELEASES[0]!.version;
