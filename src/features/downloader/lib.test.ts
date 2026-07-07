import { describe, expect, it } from "vitest";
import {
  applyProgress,
  applyTaskUpdate,
  formatBytes,
  formatDuration,
  isTerminal,
  previewFilename,
  sortTasks,
  statusLabel,
} from "./lib";
import type { DownloadTask } from "./types";

const task = (overrides: Partial<DownloadTask> = {}): DownloadTask => ({
  id: "t1",
  url: "https://x/v",
  title: "Vid",
  thumbnail: null,
  presetId: "best",
  status: { kind: "queued" },
  percent: 0,
  speed: null,
  eta: null,
  outputDir: "C:\\Downloads",
  filename: null,
  outputPath: null,
  createdAt: 100,
  ...overrides,
});

describe("task map merging", () => {
  it("applyTaskUpdate inserts and replaces without mutating", () => {
    const m0 = new Map<string, DownloadTask>();
    const m1 = applyTaskUpdate(m0, task());
    const m2 = applyTaskUpdate(m1, task({ percent: 50, status: { kind: "downloading" } }));
    expect(m0.size).toBe(0);
    expect(m1.get("t1")!.percent).toBe(0);
    expect(m2.get("t1")!.percent).toBe(50);
  });

  it("applyProgress updates known tasks and flips queued to downloading", () => {
    const m = applyTaskUpdate(new Map(), task());
    const m2 = applyProgress(m, { id: "t1", percent: 12.5, speed: "1MiB/s", eta: "00:30" });
    const t = m2.get("t1")!;
    expect(t.percent).toBe(12.5);
    expect(t.status.kind).toBe("downloading");
  });

  it("applyProgress ignores unknown ids", () => {
    const m = applyTaskUpdate(new Map(), task());
    const m2 = applyProgress(m, { id: "ghost", percent: 5, speed: null, eta: null });
    expect(m2.size).toBe(1);
    expect(m2.has("ghost")).toBe(false);
  });

  it("does not downgrade muxing status on late progress", () => {
    const m = applyTaskUpdate(new Map(), task({ status: { kind: "muxing" } }));
    const m2 = applyProgress(m, { id: "t1", percent: 100, speed: null, eta: null });
    expect(m2.get("t1")!.status.kind).toBe("muxing");
  });
});

describe("sorting and terminality", () => {
  it("sortTasks newest first", () => {
    const m = new Map([
      ["a", task({ id: "a", createdAt: 1 })],
      ["b", task({ id: "b", createdAt: 9 })],
    ]);
    expect(sortTasks(m).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("isTerminal", () => {
    expect(isTerminal(task({ status: { kind: "done" } }))).toBe(true);
    expect(isTerminal(task({ status: { kind: "error", message: "x" } }))).toBe(true);
    expect(isTerminal(task({ status: { kind: "downloading" } }))).toBe(false);
  });
});

describe("formatting", () => {
  it("formatBytes", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(0)).toBeNull();
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(94371840 + 3456789)).toBe("93.3 MB");
  });

  it("formatDuration", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(213.4)).toBe("3:33");
    expect(formatDuration(3671)).toBe("1:01:11");
  });

  it("previewFilename mirrors the Rust sanitizer", () => {
    expect(previewFilename("My Video")).toBe("My Video");
    expect(previewFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(previewFilename("..\\..\\evil")).toBe("_.._evil");
    expect(previewFilename("CON")).toBe("_CON");
    expect(previewFilename("con.mp4")).toBe("_con.mp4");
    expect(previewFilename("badname...")).toBe("badname");
    expect(previewFilename("x".repeat(500)).length).toBe(200);
  });

  it("statusLabel for downloading includes percent/speed/eta", () => {
    const t = task({
      status: { kind: "downloading" },
      percent: 42.4,
      speed: "8MiB/s",
      eta: "00:12",
    });
    expect(statusLabel(t)).toBe("42% · 8MiB/s · 00:12");
    expect(statusLabel(task({ status: { kind: "error", message: "x" } }))).toBe("Failed");
  });
});
