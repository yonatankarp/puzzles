import Diagram from './Diagram.tsx';
import { GAMES } from '../shell/registry.ts';
import { dayNumber, formatDuration, readResult, streak } from '../shell/daily.ts';
import { gameHref } from '../shell/route.ts';

interface Props {
  onOpen: (id: string) => void;
}

/*
 * The collection. Each card shows whether today's puzzle is done and what
 * streak is riding on it, read straight from storage — the index does not need
 * a game's engine to say that much.
 */
export default function Index({ onOpen }: Props) {
  const today = dayNumber();
  return (
    <div className="index" id="index">
      <p className="index-lede">
        Puzzles that generate themselves. Every board has exactly one solution,
        and its difficulty is measured rather than guessed.
      </p>
      <div className="cards">
        {GAMES.map(game => {
          const result = readResult(game.id, today);
          const days = streak(game.id, today);
          return (
            <a
              key={game.id}
              className="card"
              id={`card-${game.id}`}
              href={gameHref(game.id)}
              onClick={event => { event.preventDefault(); onOpen(game.id); }}
              style={{ '--card': game.accent } as React.CSSProperties}
            >
              {/*
                * A solved board of the game, beside the words. Four puzzles
                * described only in prose read as four paragraphs, and the one
                * you want is the one you recognise -- a picture says "lamps and
                * beams" or "a line through squares" before a sentence can. It
                * is the same drawing the how-to-play sheet uses, so it cannot
                * illustrate a rule the game does not have.
                *
                * Decorative here, and marked so: the card already carries the
                * name, the tagline and the whole rule in text, and a screen
                * reader reading the board out a second time would only be in
                * the way.
                */}
              <span className="card-art" aria-hidden="true">
                <Diagram id={game.id} className="card-art-board" />
              </span>
              <div className="card-body">
                <div className="card-head">
                  <span className="card-dot" />
                  <b>{game.name}</b>
                  {days >= 2 && <span className="muted card-streak">🔥 {days}</span>}
                </div>
                <p className="card-tagline">{game.tagline}</p>
                <p className="card-rules muted">{game.rules}</p>
                <div className="card-foot muted">
                  {result
                    ? <>Today: <b>{formatDuration(result.ms)}</b></>
                    : <>Today&rsquo;s puzzle not solved yet</>}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
