/// <reference lib="webworker" />
import { generateDifficulty, type DifficultyName, type PatchPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';

export interface PatchRequest {
  id: number;
  kind: 'daily' | 'tier';
  tier?: DifficultyName;
  seed?: number;
}

export interface PatchReply {
  id: number;
  puzzle: PatchPuzzle | null;
}

self.addEventListener('message', (event: MessageEvent<PatchRequest>) => {
  const { id, kind, tier, seed } = event.data;
  const puzzle = kind === 'daily' ? generateDaily(seed!) : generateDifficulty(tier!, seed);
  (self as unknown as Worker).postMessage({ id, puzzle } satisfies PatchReply);
});
