import { useLayoutEffect, useRef, type RefObject } from "react";

const FLIP_DURATION_MS = 520;
const FLIP_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

const FLIP_TRANSITION = [
  `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`,
  "box-shadow 0.45s ease",
  "border-color 0.45s ease",
  "background-color 0.35s ease",
].join(", ");

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** FLIP layout transitions + enter animation for keyed list children. */
export function useFlipList<T>(
  items: T[],
  getKey: (item: T) => string,
): RefObject<HTMLUListElement | null> {
  const containerRef = useRef<HTMLUListElement>(null);
  const positionsRef = useRef(new Map<string, DOMRect>());
  const prevKeysRef = useRef<Set<string>>(new Set());
  const keysSignature = items.map(getKey).join("\0");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || prefersReducedMotion()) {
      prevKeysRef.current = new Set(
        keysSignature.length > 0 ? keysSignature.split("\0") : [],
      );
      return;
    }

    const currentKeys = new Set<string>();
    const nodes = container.querySelectorAll<HTMLElement>("[data-flip-id]");

    for (const node of nodes) {
      const id = node.dataset.flipId;
      if (!id) continue;

      currentKeys.add(id);
      const rect = node.getBoundingClientRect();
      const prev = positionsRef.current.get(id);
      const isNew = !prevKeysRef.current.has(id);

      if (isNew) {
        node.classList.add("pilpod-active-media-strip__item--enter");
        const onEnd = (event: AnimationEvent) => {
          if (event.target !== node) return;
          node.classList.remove("pilpod-active-media-strip__item--enter");
          node.removeEventListener("animationend", onEnd);
        };
        node.addEventListener("animationend", onEnd);
      } else if (prev) {
        const dx = prev.left - rect.left;
        const dy = prev.top - rect.top;

        if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
          // Promote only while the move animates — a persistent will-change
          // acts as a containing block and breaks the glass cards'
          // viewport-fixed static backgrounds (see ActiveMediaStrip.css).
          node.style.willChange = "transform";
          node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          node.style.transition = "transform 0s, box-shadow 0s, border-color 0s";

          requestAnimationFrame(() => {
            node.style.transition = FLIP_TRANSITION;
            node.style.transform = "";
          });
          window.setTimeout(() => {
            node.style.willChange = "";
          }, FLIP_DURATION_MS + 50);
        }
      }

      positionsRef.current.set(id, rect);
    }

    for (const key of positionsRef.current.keys()) {
      if (!currentKeys.has(key)) {
        positionsRef.current.delete(key);
      }
    }

    prevKeysRef.current = currentKeys;
  }, [keysSignature]);

  return containerRef;
}
