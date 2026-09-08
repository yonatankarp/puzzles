/*
 * The worked examples shown in "how to play".
 *
 * Kept as data rather than hand-drawn markup so test/diagrams.js can check them
 * against the same rules the games enforce. An illustration of "never cross a
 * wall" that crosses a wall is worse than no illustration, and that is exactly
 * what the first attempt did.
 */

/** A 3×3 Zip board, solved. Cells are row-major indices. */
export const ZIP_DIAGRAM = {
  rows: 3,
  cols: 3,
  /** Cell of number 1, 2, 3. */
  waypoints: [2, 5, 6],
  /** Blocked edges, each [min, max] of two adjacent cells. */
  walls: [[2, 5]] as Array<[number, number]>,
  /** The line, in order. */
  solution: [2, 1, 0, 3, 4, 5, 8, 7, 6]
};

/** A 4×4 Queens board, solved. */
export const QUEENS_DIAGRAM = {
  n: 4,
  /** Region per cell, row-major. */
  regions: [
    0, 0, 0, 1,
    2, 2, 2, 1,
    2, 3, 3, 1,
    3, 3, 3, 3
  ],
  /** Column of the queen in each row. */
  solution: [1, 3, 0, 2]
};
