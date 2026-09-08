/// <reference lib="webworker" />
import { generateDifficulty, type DifficultyName, type LampPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';

export interface LampRequest {
  id: number;
  kind: 'daily' | 'tier';
  tier?: DifficultyName;
  seed?: number;
}

export interface LampReply {
  id: number;
  puzzle: LampPuzzle | null;
}

self.addEventListener('message', (event: MessageEvent<LampRequest>) => {
  const { id, kind, tier, seed } = event.data;
  const puzzle = kind === 'daily' ? generateDaily(seed!) : generateDifficulty(tier!, seed);
  (self as unknown as Worker).postMessage({ id, puzzle } satisfies LampReply);
});
