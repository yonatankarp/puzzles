/*
 * Where Queens boards come from: a worker when there is one, a direct call
 * otherwise. Refining a 9x9 until it is unique takes long enough to drop frames
 * on the board still on screen.
 */
import { generateDifficulty, type DifficultyName, type QueensPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';
import type { QueensRequest, QueensReply } from './generate.worker.ts';

export class QueensSource {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (puzzle: QueensPuzzle | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<QueensReply>) => {
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

  requestDaily(seed: number): Promise<QueensPuzzle | null> {
    return this.dispatch({ kind: 'daily', seed }, () => generateDaily(seed));
  }

  requestTier(tier: DifficultyName, seed?: number): Promise<QueensPuzzle | null> {
    return this.dispatch({ kind: 'tier', tier, seed }, () => generateDifficulty(tier, seed));
  }

  private dispatch(
    request: Omit<QueensRequest, 'id'>,
    directly: () => QueensPuzzle | null
  ): Promise<QueensPuzzle | null> {
    if (!this.worker) {
      return new Promise(resolve => { setTimeout(() => resolve(directly()), 0); });
    }
    const id = ++this.seq;
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage({ id, ...request } satisfies QueensRequest);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
  }
}
