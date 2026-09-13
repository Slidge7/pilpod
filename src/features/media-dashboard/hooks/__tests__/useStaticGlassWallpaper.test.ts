import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  addToCache,
  makeCacheKey,
  MAX_CACHE_ENTRIES,
  textureCache,
  type TextureEntry,
  type Viewport,
} from "../useStaticGlassWallpaper";

describe("useStaticGlassWallpaper cache engine", () => {
  const mockViewport: Viewport = { w: 1920, h: 1080, dpr: 1 };

  beforeEach(() => {
    textureCache.clear();
    // Stub URL.revokeObjectURL
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it("generates deterministic cache keys", () => {
    const key1 = makeCacheKey("file:///wp1.jpg", 4, mockViewport);
    const key2 = makeCacheKey("file:///wp1.jpg", 4, mockViewport);
    const key3 = makeCacheKey("file:///wp2.jpg", 4, mockViewport);

    expect(key1).toBe("file:///wp1.jpg:4.00:1920x1080:1");
    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
  });

  it("caches entries and prevents duplicate insertions", () => {
    const key = makeCacheKey("wp-1", 4, mockViewport);
    const entry: TextureEntry = { floatUrl: "blob:float1", panelUrl: "blob:panel1" };

    addToCache(key, entry, new Set());
    expect(textureCache.has(key)).toBe(true);
    expect(textureCache.get(key)).toBe(entry);

    // Re-adding with same key is a no-op
    addToCache(key, { floatUrl: "blob:float2", panelUrl: "blob:panel2" }, new Set());
    expect(textureCache.get(key)).toBe(entry);
  });

  it("evicts oldest entry when exceeding MAX_CACHE_ENTRIES and revokes non-protected URLs", () => {
    const protectedUrls = new Set<string>(["blob:float-protected"]);

    // Fill cache to max
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      const key = `key-${i}`;
      const entry: TextureEntry = {
        floatUrl: i === 0 ? "blob:float-protected" : `blob:float-${i}`,
        panelUrl: `blob:panel-${i}`,
      };
      addToCache(key, entry, protectedUrls);
    }

    expect(textureCache.size).toBe(MAX_CACHE_ENTRIES);

    // Add one more entry to trigger eviction
    const overflowKey = "overflow-key";
    addToCache(overflowKey, { floatUrl: "blob:new-float", panelUrl: "blob:new-panel" }, protectedUrls);

    expect(textureCache.size).toBe(MAX_CACHE_ENTRIES);
    expect(textureCache.has(overflowKey)).toBe(true);
    // Key-0 was protected, so Key-1 should have been evicted
    expect(textureCache.has("key-1")).toBe(false);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:float-1");
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:panel-1");
  });
});
