import { BookmarkCheck, BookmarkPlus, Play, ThumbsDown, ThumbsUp } from "lucide-react";
import type { MouseEvent } from "react";

export interface CardQuickActionsProps {
  name: string;
  /** 1 = me gusta, -1 = no me gusta. Only teaches recommendations; it never reorders the grid. */
  preference?: 1 | -1;
  inLibrary: boolean;
  canPlay: boolean;
  onPreference?: (value: 1 | -1) => void;
  onAddToLibrary?: () => void;
  onPlay?: () => void;
}

/** Round buttons that pop out of the cover when the pointer rests on a game card. */
export default function CardQuickActions({ name, preference, inLibrary, canPlay, onPreference, onAddToLibrary, onPlay }: CardQuickActionsProps) {
  const stop = (action?: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    action?.();
  };
  const buttons = [
    { key: "like", label: "Me gusta", pressed: preference === 1, tone: "like", icon: <ThumbsUp size={17} />, onClick: onPreference ? stop(() => onPreference(1)) : undefined },
    { key: "dislike", label: "No me gusta", pressed: preference === -1, tone: "dislike", icon: <ThumbsDown size={17} />, onClick: onPreference ? stop(() => onPreference(-1)) : undefined },
    { key: "library", label: inLibrary ? "Ya está en tu biblioteca" : "Añadir a la biblioteca", pressed: inLibrary, tone: "library", icon: inLibrary ? <BookmarkCheck size={17} /> : <BookmarkPlus size={17} />, onClick: inLibrary ? undefined : stop(onAddToLibrary) },
    ...(canPlay ? [{ key: "play", label: "Jugar", pressed: false, tone: "play", icon: <Play size={17} fill="currentColor" />, onClick: stop(onPlay) }] : []),
  ];
  return (
    <div className="ga-quick" role="group" aria-label={`Acciones rápidas de ${name}`} style={{ "--n": buttons.length } as React.CSSProperties}>
      {buttons.map((button, index) => (
        <button
          key={button.key}
          type="button"
          className={`ga-quick-button tone-${button.tone}${button.pressed ? " is-on" : ""}`}
          style={{ "--i": index } as React.CSSProperties}
          title={button.label}
          aria-label={button.label}
          aria-pressed={button.key === "play" ? undefined : button.pressed}
          aria-disabled={button.onClick ? undefined : true}
          onClick={button.onClick}
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
