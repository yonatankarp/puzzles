interface Props {
  current: string;
  options: Array<{ id: string; label: string }>;
  onPick: (id: string) => void;
}

/** Difficulty picker. The options come from the game, so this stays shared. */
export default function Tiers({ current, options, onPick }: Props) {
  return (
    <div className="tiers" id="tiers">
      {options.map(option => (
        <button
          key={option.id}
          className="tier"
          aria-pressed={option.id === current}
          onClick={() => onPick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
