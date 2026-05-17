import type { PointerEventHandler } from "react";
import { IconMusicGlyph, IconWidgetClose } from "./icons";

type Props = {
  onRestore: () => void;
  onDismissWidget: () => void;
  gestures: {
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
  };
};

export function WidgetView({ onRestore, onDismissWidget, gestures }: Props) {
  return (
    <div className="group relative isolate h-full min-h-0 w-full overflow-hidden touch-none bg-transparent">
      <button
        type="button"
        className="pointer-events-none absolute right-0.5 top-0.5 z-20 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-red-600 text-white opacity-0 shadow-md ring-1 ring-red-800/80 transition-opacity hover:bg-red-500 group-hover:pointer-events-auto group-hover:opacity-100 dark:ring-red-900/70"
        title="Turn off floating widget — show full window"
        aria-label="Turn off floating widget and show full window"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          void onDismissWidget();
        }}
      >
        <IconWidgetClose className="shrink-0" />
      </button>
      <div
        className="flex h-full min-h-0 w-full cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
        role="button"
        tabIndex={0}
        aria-label="Open PilPod — drag to move"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void onRestore();
          }
        }}
        onPointerDown={gestures.onPointerDown}
        onPointerMove={gestures.onPointerMove}
        onPointerUp={gestures.onPointerUp}
        onPointerCancel={gestures.onPointerCancel}
      >
        <div
          className="pointer-events-none flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-2xl bg-white/95 text-amber-600 shadow-lg shadow-zinc-300/35 ring-1 ring-zinc-200 dark:bg-zinc-800/95 dark:text-amber-400 dark:shadow-black/40 dark:ring-zinc-600/80"
          title=""
          aria-hidden
        >
          <IconMusicGlyph className="h-[18px] w-[18px]" />
        </div>
      </div>
    </div>
  );
}
