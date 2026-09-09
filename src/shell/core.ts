/*
 * The part of a game that is not the game.
 *
 * Timing, the reveal gate, the daily and its streak, saved runs, preferences,
 * the banner, the session tally and publishing to React are identical whether
 * you are drawing a line or placing queens — and several of them encode
 * promises that matter: the clock belongs to the puzzle rather than the
 * attempt, a refresh cannot hand you a fresh board, the first solve of a day is
 * the one that counts. Those were written twice before this existed, which is
 * two copies that can drift apart.
 *
 * A game supplies its engine, its board, and the handful of things only it can
 * answer. Everything else lives here.
 */
import { Audio, SOUND_MODES, type SoundMode } from './audio.ts';
import { Fx } from './fx.ts';
import {
  clearProgress, dayNumber, formatDuration, history, readProgress, readResult, seedForDay,
  setClock, shareText, streak, writeProgress, writeResult
} from './daily.ts';
import { read as readPref, write as writePref } from './prefs.ts';
import type { Banner, Mode, Phase, ShareOutcome, Snapshot } from './types.ts';
import { encodeBoardCode, encodeSeed, randomSeed } from './seed.ts';
import { codeHref, gameHref } from './route.ts';
import { gameById } from './registry.ts';

/*
 * Merge two hook objects without flattening their getters.
 *
 * Object spread *evaluates* an accessor and copies the result, so `{...hooks}`
 * turns `get day()` into whatever the day happened to be at that moment. A
 * frozen reading then makes correct behaviour look broken -- which is exactly
 * how it was found.
 */
export function mergeHooks<A extends object, B extends object>(base: A, own: B): A & B {
  const merged = {} as A & B;
  Object.defineProperties(merged, Object.getOwnPropertyDescriptors(base));
  Object.defineProperties(merged, Object.getOwnPropertyDescriptors(own));
  return merged;
}

const AUTO_NEXT_DELAY = 1800;
const COUNT_IN_STEP = 650;
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const CHEERS = ['Nice.', 'Clean run.', 'Smooth.', 'Tidy.', 'Got it.', 'Locked in.'];

/** What the shell needs from a game to fill in the parts of the snapshot it cannot know. */
export interface GameProgress {
  done: number;
  total: number;
  /** Phrased for a screen reader: "squares filled", "queens placed". */
  unit: string;
  /** One line on what to aim at next. */
  goal: string;
  sizeLabel: string;
  progressColour: string | null;
}

export interface TierInfo {
  id: string;
  label: string;
}

export abstract class ShellCore<P> {
  // ---- what a game must answer ---------------------------------------------
  abstract readonly gameId: string;
  abstract readonly displayName: string;
  /** The tier the daily always uses, independent of the practice tiers. */
  protected abstract readonly dailyTier: string;

  protected abstract tiers(): TierInfo[];
  protected abstract tierLabel(id: string): string;
  protected abstract requestDaily(seed: number): Promise<P | null>;
  protected abstract requestTier(tier: string, seed: number): Promise<P | null>;
  protected abstract fingerprint(puzzle: P): string;
  /** Wipe whatever the player had done; called only when a board is new. */
  protected abstract resetState(puzzle: P): void;
  /*
   * Install a board. Called with covered=true when it arrives and again with
   * covered=false at the reveal, so it must not disturb the run in progress --
   * that is what resetState is for.
   */
  protected abstract applyPuzzle(puzzle: P, covered: boolean): void;
  /** Draw the current state. */
  protected abstract redraw(): void;
  protected abstract progress(): GameProgress;
  /** Encode the run so it can be replayed after a reload. */
  protected abstract encodeMoves(): number[];
  /** Replay a saved run, rejecting anything that does not fit this board. */
  protected abstract decodeMoves(moves: number[]): boolean;
  /** Where the celebration should come from. */
  protected abstract celebrationCell(): number | null;
  /** Wire the board's own input. Returns teardown functions. */
  protected abstract attachInput(boardSvg: SVGSVGElement): Array<() => void>;

  protected onRestart(): void { /* game-specific clearing, if any */ }
  protected onUndo(): void { /* not every game has one */ }
  protected onHint(): void { /* not every game has one */ }
  protected onReveal(): void { /* not every game has one */ }
  protected onFrame(_now: number): void { /* per-frame board work, if any */ }
  protected onKeyExtra(_e: KeyboardEvent): boolean { return false; }
  protected clearBoardExtras(): void { /* hints, overlays */ }
  /*
   * Let go of whatever the game holds outside the DOM. Every game generates in
   * a worker, and nothing ever shut one down: index -> game -> index -> game
   * left a worker running per visit, each holding the module graph it was
   * started with. destroy() unhooks the listeners, so this is where the rest of
   * the teardown belongs.
   */
  protected releaseResources(): void { /* a game with nothing to let go of says nothing */ }
  /** Board flourishes a game runs on a win, before the confetti. */
  protected onSolvedEffects(): void { /* sweeps, pops */ }

  // ---- state the shell owns -------------------------------------------------
  readonly audio: Audio;
  protected fx: Fx | null = null;
  protected puzzle: P | null = null;
  protected board: unknown = null;

  private clockEl: HTMLElement | null = null;
  private announcerEl: HTMLElement | null = null;
  protected regionEl: HTMLElement | null = null;

  protected elapsed = 0;
  protected running = false;
  private startedAt = 0;
  private timerStarted = false;
  protected solved = false;
  protected revealed = false;
  /*
   * Whether this board was ever given away. `revealed` cannot answer that,
   * because Restart deliberately takes it back off -- it is what uncovers the
   * board again -- and that left the whole door open: Reveal, Restart, play
   * back the solution you were just shown, and the daily was recorded with a
   * streak. This one only ever clears when a new board arrives.
   */
  protected gaveUp = false;
  protected hintsUsed = 0;
  protected backtracks = 0;
  protected phase: Phase = 'ready';

  private busy = false;
  private banner: Banner | null = null;
  private countdown: number | null = null;
  private countdownTimer = 0;
  private bannerTimer = 0;
  private advanceTimer = 0;
  private autoStart = false;
  private lastCheer = -1;

  private loadSeq = 0;
  /*
   * The seed the board on screen was generated from. The shell picks it rather
   * than letting the generator invent one privately, because a seed nobody can
   * read back is a seed nobody can share.
   */
  protected seed = 0;
  protected seedTier = '';
  private loadingDay: number | null = null;
  private savedAt = 0;
  private frame = 0;
  protected alive = false;
  private dirty = true;
  private listeners = new Set<(s: Snapshot) => void>();
  private detachers: Array<() => void> = [];

  difficulty: string;
  mode: Mode;
  day = dayNumber();
  autoNext: boolean;
  session = { solved: 0, total: 0, streak: 0 };

  constructor(gameId: string, defaultTier: string) {
    const stored = readPref('app.sound');
    const mode: SoundMode = stored === 'on' ? 'all'
      : SOUND_MODES.includes(stored as SoundMode) ? stored as SoundMode : 'off';
    this.audio = new Audio(mode);
    this.difficulty = readPref(`${gameId}.difficulty`) ?? defaultTier;
    this.mode = readPref(`${gameId}.mode`) === 'practice' ? 'practice' : 'daily';
    this.autoNext = readPref(`${gameId}.autoNext`) !== 'off';
  }

  // ---- lifecycle -------------------------------------------------------------

  attach(boardSvg: SVGSVGElement, fxSvg: SVGSVGElement): void {
    this.fx = new Fx(fxSvg);
    const key = (e: KeyboardEvent) => this.onKey(e);
    const leaving = () => this.saveProgress(true);
    const returning = () => { if (!document.hidden) this.checkRollover(); };

    document.addEventListener('keydown', key);
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', leaving);
    document.addEventListener('visibilitychange', returning);
    this.detachers = [
      ...this.attachInput(boardSvg),
      () => document.removeEventListener('keydown', key),
      () => window.removeEventListener('pagehide', leaving),
      () => document.removeEventListener('visibilitychange', leaving),
      () => document.removeEventListener('visibilitychange', returning)
    ];

    this.alive = true;
    this.frame = requestAnimationFrame(this.tick);
    this.newPuzzle();
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.frame);
    clearTimeout(this.advanceTimer);
    clearTimeout(this.countdownTimer);
    clearTimeout(this.bannerTimer);
    for (const off of this.detachers) off();
    this.detachers = [];
    this.listeners.clear();
    this.releaseResources();
  }

  bindClock(el: HTMLElement | null): void { this.clockEl = el; }
  bindAnnouncer(el: HTMLElement | null): void { this.announcerEl = el; }
  bindRegion(el: HTMLElement | null): void { this.regionEl = el; }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  protected markDirty(): void { this.dirty = true; }

  /*
   * Spoken feedback. Without it a board that mutates by hand announces nothing
   * at all, and the game is unplayable with a screen reader.
   */
  protected announce(text: string): void {
    if (!this.announcerEl) return;
    this.announcerEl.textContent = this.announcerEl.textContent === text ? `${text} ` : text;
  }

  private tick = (): void => {
    const now = performance.now();
    if (this.running) this.elapsed = now - this.startedAt;
    if (this.clockEl) {
      this.clockEl.textContent = formatDuration(this.elapsed);
      this.clockEl.classList.toggle('done', this.solved);
    }
    this.onFrame(now);
    this.fx?.tick(now);
    this.saveProgress();
    if (this.dirty) { this.dirty = false; this.publish(); }
    this.frame = requestAnimationFrame(this.tick);
  };

  // ---- snapshot ---------------------------------------------------------------

  snapshot(): Snapshot {
    const tier = this.mode === 'daily' ? this.dailyTier : this.difficulty;
    const p = this.progress();
    return {
      gameId: this.gameId,
      seed: this.seed,
      seedCode: encodeSeed(this.seed),
      seedTier: this.seedTier,
      ready: !!this.puzzle,
      busy: this.busy,
      mode: this.mode,
      phase: this.phase,
      countdown: this.countdown,
      day: this.day,
      dailyResult: readResult(this.gameId, this.day),
      streak: streak(this.gameId, this.day),
      backtracks: this.backtracks,
      done: p.done,
      total: p.total,
      unit: p.unit,
      goal: p.goal,
      solved: this.solved,
      best: this.shownBest(),
      difficulty: tier,
      difficultyLabel: this.seedTier === 'daily' && this.mode === 'practice'
        ? 'Daily board'
        : this.tierLabel(tier),
      boardCode: this.boardCode(),
      difficulties: this.tiers(),
      sizeLabel: p.sizeLabel,
      progressColour: p.progressColour,
      session: { ...this.session },
      banner: this.banner,
      autoNext: this.autoNext,
      soundMode: this.audio.mode,
      theme: 'system'
    };
  }

  private publish(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private bestKey(): string { return `${this.gameId}.best.${this.difficulty}`; }
  private bestTime(): number | null {
    const value = readPref(this.bestKey());
    return value === null ? null : Number(value);
  }

  /*
   * The best the row is standing next to. Practice bests are kept per tier, and
   * the daily is not one of those tiers -- so in daily mode the practice record
   * was being shown beside a daily label, next to a history strip quoting a
   * different best entirely, for a time the day's play could never beat. The
   * daily's own best is what belongs there, computed over the same 30 days the
   * strip below it reports.
   */
  private shownBest(): number | null {
    return this.mode === 'daily' ? history(this.gameId, this.day).best : this.bestTime();
  }

  // ---- the clock ---------------------------------------------------------------

  /** Called by a game the moment a real move happens. */
  protected startClock(): void {
    if (this.running || this.solved) return;
    this.running = true;
    this.timerStarted = true;
    this.startedAt = performance.now() - this.elapsed;
  }

  protected stopClock(): void { this.running = false; }

  /** Reveal with no count-in. Used by tests, which would otherwise pay for it. */
  revealNow(): void {
    if (this.phase === 'playing' || !this.puzzle) return;
    clearTimeout(this.countdownTimer);
    this.countdown = null;
    this.phase = 'playing';
    this.applyPuzzle(this.puzzle, false);
    this.startClock();
    this.redraw();
    this.markDirty();
  }

  /*
   * Reveal the board and start the clock in the same instant. Studying a board
   * for free before the timer ran made every recorded time a fiction.
   */
  start(): void {
    if (this.phase !== 'ready' || !this.puzzle) return;
    this.phase = 'counting';
    this.countdown = 3;
    this.markDirty();
    const step = () => {
      this.countdownTimer = window.setTimeout(() => {
        if (!this.alive) return;
        if (this.countdown && this.countdown > 1) {
          this.countdown--;
          this.markDirty();
          step();
          return;
        }
        this.countdown = null;
        this.phase = 'playing';
        this.applyPuzzle(this.puzzle!, false);
        this.startClock();
        this.redraw();
        this.markDirty();
      }, COUNT_IN_STEP);
    };
    step();
  }

  // ---- banners and results -------------------------------------------------------

  private cheer(): string {
    let pick = this.lastCheer;
    while (pick === this.lastCheer && CHEERS.length > 1) pick = (Math.random() * CHEERS.length) | 0;
    this.lastCheer = pick;
    return CHEERS[pick]!;
  }

  protected setBanner(banner: Banner | null, clearAfter?: number): void {
    clearTimeout(this.bannerTimer);
    this.banner = banner;
    if (banner) this.announce(banner.sub ? `${banner.text}. ${banner.sub}` : banner.text);
    if (banner && clearAfter) {
      this.bannerTimer = window.setTimeout(() => this.setBanner(null), clearAfter);
    }
    this.markDirty();
  }

  /** A game calls this once its own rules say the board is finished. */
  protected finish(): void {
    this.solved = true;
    this.stopClock();
    this.redraw();
    // A board still wearing its answer has not been finished by anybody.
    if (this.revealed) return;

    /*
     * A board given away and then cleared and solved by hand is a real solve
     * and not a result: the time is honest, but the board was seen first, so
     * it sets no record and the daily does not count it -- and Restart, which
     * takes the cover back off, does not undo the giving away.
     *
     * It still finishes, though. Swallowing the win outright was the first
     * shape of this and it was wrong in the other direction: no banner, no
     * flourish, no tally, nothing at all to say the board was done, which reads
     * as the game breaking rather than as a rule being applied. It says what
     * happened instead.
     */
    if (this.gaveUp) {
      this.setBanner({
        text: `Solved · ${formatDuration(this.elapsed)}`,
        kind: 'wait',
        sub: this.mode === 'daily'
          ? 'the answer was shown first, so today is not recorded'
          : 'the answer was shown first, so this is not a record'
      });
      this.audio.win(false);
      if (!reducedMotion()) this.onSolvedEffects();
      this.celebrate(false);
      return;
    }

    this.session.solved++;
    this.session.total += this.elapsed;
    this.session.streak++;
    const backtracks = `${this.backtracks} backtrack${this.backtracks === 1 ? '' : 's'}`;
    let isBest = false;

    if (this.mode === 'daily') {
      const first = !readResult(this.gameId, this.day);
      writeResult(this.gameId, {
        day: this.day, ms: Math.round(this.elapsed),
        backtracks: this.backtracks, hinted: this.hintsUsed > 0,
        board: this.fingerprint(this.puzzle!)
      });
      clearProgress(this.gameId);
      const days = streak(this.gameId, this.day);
      this.setBanner({
        text: `Daily #${this.day} · ${formatDuration(this.elapsed)}`,
        kind: 'good',
        sub: `${backtracks}${this.hintsUsed ? ' · used a hint' : ''}` +
          (first && days >= 2 ? ` · ${days} day streak` : first ? '' : ' · already logged today')
      });
    } else {
      const previous = Number(this.bestTime() ?? Infinity);
      // A hinted solve counts for the session but never sets a record: a best
      // time you were walked through is not a time.
      isBest = this.elapsed < previous && this.hintsUsed === 0;
      if (isBest) writePref(this.bestKey(), String(Math.round(this.elapsed)));
      let sub: string | undefined;
      if (this.hintsUsed) {
        sub = `${this.hintsUsed} ${this.hintsUsed === 1 ? 'hint' : 'hints'} — not a record`;
      } else if (Number.isFinite(previous)) {
        sub = isBest
          ? `beat ${formatDuration(previous)}`
          : `${formatDuration(this.elapsed - previous)} off your best`;
      }
      this.setBanner({
        text: `${isBest ? 'New best · ' : `${this.cheer()} · `}${formatDuration(this.elapsed)}`,
        kind: 'good', sub: sub ? `${backtracks} · ${sub}` : backtracks
      });
    }

    this.audio.win(isBest);
    if (!reducedMotion()) this.onSolvedEffects();
    this.celebrate(isBest);
    // Auto-next belongs to practice: there is only one puzzle a day.
    if (this.autoNext && this.mode === 'practice') {
      this.advanceTimer = window.setTimeout(() => {
        this.autoStart = true;                 // continuing was already agreed to
        this.newPuzzle();
      }, AUTO_NEXT_DELAY);
    }
  }

  private celebrate(isBest: boolean): void {
    if (reducedMotion()) return;
    const cell = this.celebrationCell();
    if (cell === null) return;
    const origin = (this.board as { centreInViewport(c: number): { x: number; y: number } | null } | null)
      ?.centreInViewport(cell);
    const rect = (this.board as { rectInViewport(): DOMRect | null } | null)?.rectInViewport();
    if (origin && rect) this.fx?.celebrate(origin, rect, isBest);
  }

  // ---- puzzles ------------------------------------------------------------------

  protected load(puzzle: P): void {
    this.loadSeq++;
    this.busy = false;
    this.puzzle = puzzle;
    this.elapsed = 0;
    this.running = false;
    this.timerStarted = false;
    this.solved = false;
    this.revealed = false;
    this.gaveUp = false;                       // a new board is nobody's give-up yet
    this.hintsUsed = 0;
    this.backtracks = 0;
    clearTimeout(this.countdownTimer);
    this.countdown = null;
    this.phase = 'ready';
    this.fx?.clear();
    this.setBanner(null);
    this.resetState(puzzle);
    this.applyPuzzle(puzzle, true);            // a new board arrives covered
    this.redraw();
    this.markDirty();
    if (this.autoStart) { this.autoStart = false; this.start(); }
  }

  newPuzzle(): void {
    this.loadTier(this.difficulty, randomSeed());
  }

  /**
   * Play one exact board. The tier is as load-bearing as the number: the
   * generator is entered per tier, so the same seed is a different puzzle at
   * every difficulty.
   */
  loadTier(tier: string, seed: number): void {
    clearTimeout(this.advanceTimer);
    if (this.mode === 'daily') { this.loadDaily(); return; }
    /*
     * An unknown tier would not fail -- the generator falls back to medium --
     * it would quietly build a medium board while the screen said whatever the
     * link claimed. Someone would then be racing a board they were not shown.
     */
    if (!this.tiers().some(t => t.id === tier)) {
      this.busy = false;
      this.setBanner({ text: `There is no ${tier} board in this game`, kind: 'bad' });
      this.publish();
      return;
    }
    this.difficulty = tier;
    this.busy = true;
    this.setBanner({ text: 'Generating…', kind: 'wait' });
    this.publish();
    /*
     * Claim the sequence when the board is ASKED for. It used to be claimed
     * only when one landed, which meant that with two generations in flight the
     * first to finish cancelled the other -- and since an easier tier builds
     * faster, tapping Medium then Expert left you on Medium, holding a tier you
     * had not chosen. Newest request wins; a direct load() still cancels both.
     */
    const seq = ++this.loadSeq;
    void this.requestTier(tier, seed).then(puzzle => {
      // Generation is deferred, so a result can arrive after something else has
      // been loaded; a superseded one drops its result rather than landing.
      if (!this.alive || seq !== this.loadSeq) return;
      this.busy = false;
      if (puzzle) {
        /*
         * Only now. Naming the seed when it is asked for rather than when the
         * board arrives means that for as long as generation takes -- three
         * seconds for an expert board -- the chip names one board while another
         * is on screen, and the link hands someone a puzzle you never played.
         */
        this.seed = seed;
        this.seedTier = tier;
        this.setBanner(null);
        this.load(puzzle);
        return;
      }
      /*
       * A seed that cannot be built is the one case where saying nothing is
       * indefensible: someone followed a link to a specific board and would be
       * left looking at whatever happened to be on screen.
       */
      this.setBanner({ text: `Seed ${encodeSeed(seed)} did not make a board`, kind: 'bad' });
    });
  }

  private loadDaily(): void {
    const day = dayNumber();
    if (this.loadingDay === day) return;
    this.loadingDay = day;
    const seq = ++this.loadSeq;
    const seed = seedForDay(this.gameId, day);
    void this.requestDaily(seed).then(puzzle => {
      this.loadingDay = null;
      if (!this.alive || seq !== this.loadSeq || !puzzle) return;
      // Only now: moving the day first would name a new day while the previous
      // board was still on screen.
      this.day = day;
      this.seed = seed;
      this.seedTier = 'daily';
      this.load(puzzle);
      this.restoreProgress();
    });
  }

  /*
   * A tab left open across midnight would otherwise serve yesterday's board
   * forever. Switch when the run is idle; leave one in progress alone, because
   * swapping the board mid-solve is worse than being a day behind.
   */
  protected checkRollover(): void {
    if (this.mode !== 'daily') return;
    if (dayNumber() === this.day) return;
    /*
     * Idle means "no moves made", which is not the same as "no progress shown".
     * Queens stopped counting clashing queens towards done, so a board carrying
     * only clashing queens reported done === 0 and a run someone was in the
     * middle of would have been swapped out from under them at UTC midnight.
     * The recorded moves are the honest answer and are game-agnostic.
     */
    const untouched = this.encodeMoves().length === 0;
    if (untouched || this.solved || this.revealed) this.loadDaily();
  }

  private restoreProgress(): void {
    const saved = readProgress(this.gameId, this.day);
    if (!saved || readResult(this.gameId, this.day)) return;
    // A run saved against a different board -- because the generator changed --
    // cannot be replayed onto this one.
    if (saved.board && saved.board !== this.fingerprint(this.puzzle!)) {
      clearProgress(this.gameId);
      return;
    }
    if (!this.decodeMoves(saved.moves)) return;
    this.backtracks = saved.backtracks;
    this.hintsUsed = saved.hintsUsed;
    this.elapsed = saved.elapsed;
    // The clock belongs to the puzzle, so it picks up where it left off.
    this.timerStarted = true;
    this.running = true;
    this.startedAt = performance.now() - this.elapsed;
    this.phase = 'playing';                    // this board has already been seen
    this.applyPuzzle(this.puzzle!, false);
    this.redraw();
    this.markDirty();
  }

  /** Cheap enough to call every frame; throttled so storage is not hammered. */
  private saveProgress(force = false): void {
    // gaveUp as well as revealed: after Reveal then Restart the board is
    // uncovered again with revealed back to false, and without this the replay
    // of a solution that had just been shown was saved and restored as if it
    // were an honest run.
    if (this.mode !== 'daily' || !this.puzzle || this.solved || this.revealed || this.gaveUp) return;
    const now = performance.now();
    if (!force && now - this.savedAt < 1000) return;
    this.savedAt = now;
    const moves = this.encodeMoves();
    if (!moves.length) { clearProgress(this.gameId); return; }
    writeProgress(this.gameId, {
      day: this.day,
      board: this.fingerprint(this.puzzle),
      moves,
      elapsed: Math.round(this.elapsed),
      backtracks: this.backtracks,
      hintsUsed: this.hintsUsed
    });
  }

  // ---- actions --------------------------------------------------------------------

  /*
   * Nothing but Start does anything useful on a covered board, and one of them
   * was a trap: Reveal set `revealed` without touching `phase`, so a daily given
   * away from the gate was drawn under the cover and then never recorded,
   * however honestly it was finished afterwards -- no result, no streak, and
   * nothing on screen saying so. So the board's own controls stay out of the way
   * until there is something to act on, and say why rather than doing nothing at
   * all -- they cannot be greyed out from here, since the row is handed only the
   * mode.
   */
  private notPlaying(): boolean {
    if (this.phase === 'playing') return false;
    if (this.phase === 'ready' && this.puzzle) {
      this.setBanner({ text: 'Start first', kind: 'bad', sub: 'the board is still covered' }, 1600);
    }
    return true;
  }

  restart(): void {
    clearTimeout(this.advanceTimer);
    if (!this.puzzle || this.notPlaying()) return;
    this.solved = false;
    this.revealed = false;
    /*
     * Clearing the board never clears the time -- otherwise a bad run could be
     * wiped to protect a best -- and it resumes straight away rather than
     * waiting for the first move, so hesitating costs what it should.
     */
    if (this.timerStarted) {
      this.running = true;
      this.startedAt = performance.now() - this.elapsed;
    }
    this.onRestart();
    this.clearBoardExtras();
    this.fx?.clear();
    this.setBanner(null);
    this.redraw();
    this.markDirty();
  }

  /*
   * The auto-next timer goes, the way it does for restart, hint and reveal.
   * Undo was the one board action that left it running, so pressing U in the
   * second and a bit after a solve took the last move back and then had the
   * board swapped out from under you anyway.
   */
  undo(): void { if (this.notPlaying()) return; clearTimeout(this.advanceTimer); this.onUndo(); }
  hint(): void { if (this.notPlaying()) return; clearTimeout(this.advanceTimer); this.onHint(); }

  reveal(): void {
    if (!this.puzzle || this.notPlaying()) return;
    clearTimeout(this.advanceTimer);
    this.stopClock();
    this.revealed = true;
    this.gaveUp = true;
    /*
     * And the saved run goes with it. saveProgress refuses to write once the
     * board is revealed, which meant the run as it stood a moment before the
     * reveal was still sitting in storage: reload, and it came back as an
     * ordinary run in progress with nothing remembering the answer had been
     * shown.
     */
    clearProgress(this.gameId);
    this.solved = false;
    this.session.streak = 0;
    this.onReveal();
    this.redraw();
    this.setBanner({ text: 'Revealed', kind: 'bad' });
  }

  setDifficulty(id: string): void {
    this.difficulty = id;
    writePref(`${this.gameId}.difficulty`, id);
    this.newPuzzle();
    this.markDirty();
  }

  /** Practice, without the new board that setMode would immediately request. */
  private enterPractice(): void {
    if (this.mode === 'practice') return;
    this.mode = 'practice';
    writePref(`${this.gameId}.mode`, 'practice');
    this.markDirty();
  }

  /**
   * Play a board someone identified by its code: their game, their difficulty,
   * their seed. Nothing here reads the local difficulty preference, because the
   * whole point is that the board is theirs and not ours.
   */
  loadBoardCode(tier: string, seed: number): void {
    /*
     * A daily board is not replayable, and the reason is not tidiness. Loading
     * today's daily seed as a practice board lets you learn the board, then go
     * to the daily tab and record a time for a puzzle you have already solved.
     * The recorded time would be real, the streak would be real, and nothing
     * anywhere would show that the board had been seen before. So a daily code
     * identifies a board -- it is on screen to check you are both on the same
     * one -- but it will not open one.
     */
    if (tier === 'daily') {
      this.setBanner({ text: 'A daily board cannot be replayed', kind: 'bad' });
      this.publish();
      return;
    }
    this.enterPractice();
    this.loadTier(tier, seed);
  }

  /** The code for the board on screen, or '' before one has arrived. */
  boardCode(): string {
    const meta = gameById(this.gameId);
    if (!meta || !this.puzzle) return '';
    const tier = this.mode === 'daily' ? 'daily' : (this.seedTier || this.difficulty);
    return encodeBoardCode(meta.code, tier, this.seed) ?? '';
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    writePref(`${this.gameId}.mode`, mode);
    this.newPuzzle();
    this.markDirty();
  }

  toggleAutoNext(): void {
    this.autoNext = !this.autoNext;
    writePref(`${this.gameId}.autoNext`, this.autoNext ? 'on' : 'off');
    if (!this.autoNext) clearTimeout(this.advanceTimer);
    this.markDirty();
  }

  /*
   * Hand the result to the native share sheet where there is one, and fall back
   * to the clipboard everywhere else. navigator.share must be reached from the
   * user gesture, so nothing may be awaited before it.
   */
  async share(): Promise<ShareOutcome> {
    const result = readResult(this.gameId, this.day);
    if (!result) return 'failed';
    const text = shareText(this.displayName, result, streak(this.gameId, this.day),
      location.origin + location.pathname);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: this.displayName, text });
        return 'shared';
      } catch (err) {
        // Dismissing is a decision, not a failure; do not then quietly copy.
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  /**
   * The address that reproduces exactly the board on screen. In practice that
   * is the seed and its tier; the daily needs neither, because today's board is
   * the same one for everybody.
   */
  seedLink(): string {
    const base = location.origin + location.pathname;
    // The daily is the same board for everyone today, so it links to itself
    // rather than to a code that would refuse to open anyway.
    return base + (this.mode === 'daily' ? gameHref(this.gameId) : codeHref(this.boardCode()));
  }

  /*
   * Same route out as a result: the native sheet if there is one, the clipboard
   * otherwise, and nothing awaited before navigator.share so it still counts as
   * coming from the tap.
   */
  async shareSeed(): Promise<ShareOutcome> {
    const code = this.boardCode();
    const text = `${this.displayName} · ${this.snapshot().difficultyLabel} · ${code}\n${this.seedLink()}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `${this.displayName} · ${code}`, text });
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  // ---- keyboard ---------------------------------------------------------------------

  protected ownsKeyboard(): boolean {
    const active = document.activeElement;
    return !active || active === document.body || active === this.regionEl;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.audio.markInteracted();
    /*
     * The guard comes first, before any key is claimed. Starting on space sat
     * above it, and this is a listener on the document: it fired wherever you
     * were typing. The rules sheet that opens itself could not be dismissed
     * with enter on its own close button, the daily's clock started behind
     * that sheet, and enter in the "play a code" box started a board instead
     * of submitting the form. Nothing focused still means document.body, so
     * bare space starts as it always did, and the Start button starts itself
     * through its own onClick.
     *
     * It has to sit above onKeyExtra as well as below the guard: Queens claims
     * space for its own cycle and hands it back as consumed, which would
     * swallow the start it is standing in front of.
     */
    if (!this.ownsKeyboard()) return;
    if (this.phase === 'ready' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      this.start();
      return;
    }
    if (this.onKeyExtra(e)) return;
    const key = e.key.toLowerCase();
    if (key === 'u' || e.key === 'Backspace') { e.preventDefault(); this.undo(); }
    else if (key === 'h') this.hint();
    else if (key === 'r') this.restart();
    else if (key === 'n') this.newPuzzle();
  }

  /*
   * Tests drive the UTC-midnight boundary through this. It deliberately does
   * not update `day`: that tracks the board currently loaded, and letting it
   * jump here would hide the rollover this exists to exercise.
   */
  useClock(fn: () => Date): void { setClock(fn); }

  /** Shared test surface; each game adds its own on top. */
  protected baseHooks() {
    const core = this;
    return {
      core,
      start: () => core.start(),
      reveal: () => core.revealNow(),
      restart: () => core.restart(),
      newPuzzle: () => core.newPuzzle(),
      undo: () => core.undo(),
      hint: () => core.hint(),
      share: () => core.share(),
      setMode: (mode: Mode) => core.setMode(mode),
      setDifficulty: (id: string) => core.setDifficulty(id),
      toggleAutoNext: () => core.toggleAutoNext(),
      useClock: (fn: () => Date) => core.useClock(fn),
      checkRollover: () => core.checkRollover(),
      today: () => dayNumber(),
      audio: core.audio,
      get day() { return core.day; }
    };
  }
}
