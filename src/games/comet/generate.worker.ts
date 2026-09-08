/// <reference lib="webworker" />
import { generateDifficulty, type DifficultyName, type CometPuzzle } from './engine.ts';
import { generateDaily } from './daily.ts';

export interface CometRequest {
  id: number;
  kind: 'daily' | 'tier';
  tier?: DifficultyName;
  seed?: number;
}

export interface CometReply {
  id: number;
  puzzle: CometPuzzle | null;
}

self.addEventListener('message', (event: MessageEvent<CometRequest>) => {
  const { id, kind, tier, seed } = event.data;
  const puzzle = kind === 'daily' ? generateDaily(seed!) : generateDifficulty(tier!, seed);
  (self as unknown as Worker).postMessage({ id, puzzle } satisfies CometReply);
});
