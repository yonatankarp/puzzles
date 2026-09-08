/*
 * Where Comet boards come from: a worker when there is one, a direct call
 * otherwise. A board is cheap here -- a couple of milliseconds -- but the tier
 * search can retry a few hundred times for an expert band, and that is enough
 * to be worth keeping off the thread that is drawing.
 */
import { generateDifficulty, type DifficultyName, type CometPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';
import type { CometRequest, CometReply } from './generate.worker.ts';

export class CometSource {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (puzzle: CometPuzzle | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<CometReply>) => {
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

  requestDaily(seed: number): Promise<CometPuzzle | null> {
    return this.dispatch({ kind: 'daily', seed }, () => generateDaily(seed));
  }

  requestTier(tier: DifficultyName, seed?: number): Promise<CometPuzzle | null> {
    return this.dispatch({ kind: 'tier', tier, seed }, () => generateDifficulty(tier, seed));
  }

  private dispatch(
    request: Omit<CometRequest, 'id'>,
    directly: () => CometPuzzle | null
  ): Promise<CometPuzzle | null> {
    if (!this.worker) {
      return new Promise(resolve => { setTimeout(() => resolve(directly()), 0); });
    }
    const id = ++this.seq;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ id, ...request } satisfies CometRequest);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
  }
}
