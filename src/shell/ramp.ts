/*
 * The colour a game uses to show how far through a board you are. It lives in
 * the shell rather than in Zip because progress is not a Zip idea -- every game
 * has a sense of "this far along", and they should all say it the same way.
 */
const RAMP: Array<[number, number, number]> = [
  [56, 189, 248],
  [124, 108, 246],
  [176, 92, 232],
  [255, 95, 158]     // pink, at the end
];

/** Colour a fraction `t` of the way through. */
export function rampColour(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const span = (RAMP.length - 1) * clamped;
  const i = Math.min(RAMP.length - 2, Math.floor(span));
  const f = span - i;
  const from = RAMP[i]!;
  const to = RAMP[i + 1]!;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(from[0], to[0])}, ${mix(from[1], to[1])}, ${mix(from[2], to[2])})`;
}
