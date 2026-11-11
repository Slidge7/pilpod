import { describe, expect, it } from "vitest";
import { createLimiter } from "../limit";

describe("createLimiter", () => {
  it("never runs more than max tasks at once, and runs them all", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const task = (id: number) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      done.push(id);
      return id;
    };
    const results = await Promise.all([1, 2, 3, 4, 5].map((id) => run(task(id))));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
    expect(done).toHaveLength(5);
  });

  it("keeps going after a task fails", async () => {
    const run = createLimiter(1);
    const failed = run(() => Promise.reject(new Error("x")));
    const ok = run(() => Promise.resolve("ok"));
    await expect(failed).rejects.toThrow("x");
    await expect(ok).resolves.toBe("ok");
  });
});
