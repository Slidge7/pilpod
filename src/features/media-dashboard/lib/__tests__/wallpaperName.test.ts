import { describe, expect, it } from "vitest";
import { prettyWallpaperName, wallpaperBaseName } from "../wallpaperName";

describe("wallpaper names", () => {
  it("takes the file name from either kind of path", () => {
    expect(wallpaperBaseName("C:\\Pics\\sea.jpg")).toBe("sea.jpg");
    expect(wallpaperBaseName("/home/me/sea.jpg")).toBe("sea.jpg");
    expect(wallpaperBaseName(null)).toBeNull();
  });

  it("turns file names into labels", () => {
    expect(prettyWallpaperName("01-aurora.jpg")).toBe("Aurora");
    expect(prettyWallpaperName("C:\\Pics\\beach_day.png")).toBe("Beach day");
    expect(prettyWallpaperName("wp (4).jpg")).toBe("Wallpaper 4");
    expect(prettyWallpaperName("wallpaper_03.png")).toBe("Wallpaper 3");
    expect(prettyWallpaperName("123.jpg")).toBe("Wallpaper");
    expect(prettyWallpaperName(null)).toBe("Off");
  });
});
