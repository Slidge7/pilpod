/**
 * Run at most `max` async tasks at once; the rest wait in order.
 *
 * Wallpaper previews decode full-size images (custom photos can be tens of
 * megapixels). Starting all of them at once for a folder of 200 images would
 * stall the window; two at a time keeps the gallery filling in smoothly.
 */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    running -= 1;
    waiting.shift()?.();
  };

  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        running += 1;
        task().then(resolve, reject).finally(release);
      };
      if (running < max) start();
      else waiting.push(start);
    });
  };
}
