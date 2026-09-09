/** Types the shell and every game agree on, so the chrome can be shared. */
export type Mode = 'daily' | 'practice';
export type Phase = 'ready' | 'counting' | 'playing';
export type BannerKind = 'good' | 'bad' | 'wait';
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface Banner {
  text: string;
  kind: BannerKind;
  sub?: string;
}

export interface DailyResult {
  v?: number;
  day: number;
  ms: number;
  /** Retractions, however the game counts them. */
  backtracks: number;
  hinted: boolean;
  /** Identifies the board, so a result from a changed generator is detectable. */
  board?: string;
}

export interface Snapshot {
  gameId: string;
  /** The number the board on screen was generated from, and its short form. */
  seed: number;
  seedCode: string;
  /** The whole board code: game, difficulty and seed together. */
  boardCode: string;
  /** Which generator entry the seed was used with: a tier name, or 'daily'. */
  seedTier: string;
  ready: boolean;
  busy: boolean;
  mode: Mode;
  phase: Phase;
  countdown: number | null;
  day: number;
  dailyResult: DailyResult | null;
  streak: number;
  backtracks: number;
  /** Done and total of whatever the game fills in — squares, queens. */
  done: number;
  total: number;
  /** What `done` counts, phrased for a reader: "squares filled". */
  unit: string;
  /** Short line for assistive tech: what the player is aiming at next. */
  goal: string;
  solved: boolean;
  best: number | null;
  difficulty: string;
  difficultyLabel: string;
  difficulties: Array<{ id: string; label: string }>;
  sizeLabel: string;
  /** Colour for the progress bar, so the shell need not know the game's palette. */
  progressColour: string | null;
  session: { solved: number; total: number; streak: number };
  banner: Banner | null;
  autoNext: boolean;
  soundMode: string;
  theme: string;
}
