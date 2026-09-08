/*
 * Where Lamplight boards come from: a worker when there is one, a direct call
 * otherwise. A board is cheap -- a millisecond or two -- but the tier search
 * can ask for hundreds before one lands in its band, and that is enough to be
 * worth keeping off the thread that is drawing.
 */
import { generateDifficulty, type DifficultyName, type LampPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';
import type { LampRequest, LampReply } from './generate.worker.ts';

export class LampSource {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (puzzle: LampPuzzle | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<LampReply>) => {
        const { id, puzzle } = event.data;
        this.waiting.get(id)?.(puzzle);
        this.waiting.delete(id);
      };
      this.worker.onerror = () => this.giveUp();
      this.worker.onmessageerror = () => this.giveUp();
    } catch {
      this.worker = null;
    }
  }

  get usingWorker(): boolean { return this.worker !== null; }

  private giveUp(): void {
    const stranded = [...this.waiting.values()];
    this.waiting.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const settle of stranded) settle(null);
  }

  requestDaily(seed: number): Promise<LampPuzzle | null> {
    return this.dispatch({ kind: 'daily', seed }, () => generateDaily(seed));
  }

  requestTier(tier: DifficultyName, seed?: number): Promise<LampPuzzle | null> {
    return this.dispatch({ kind: 'tier', tier, seed }, () => generateDifficulty(tier, seed));
  }

  private dispatch(
    request: Omit<LampRequest, 'id'>,
    directly: () => LampPuzzle | null
  ): Promise<LampPuzzle | null> {
    if (!this.worker) {
      return new Promise(resolve => { setTimeout(() => resolve(directly()), 0); });
    }
    const id = ++this.seq;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ id, ...request } satisfies LampRequest);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
  }
}
