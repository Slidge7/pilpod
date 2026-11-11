/** Last path segment of an absolute path (handles both / and \\ separators). */
export function wallpaperBaseName(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[/\\]+/);
  return parts[parts.length - 1] || path;
}

/**
 * A wallpaper file name as a person would say it:
 * `"01-aurora.jpg"` → `"Aurora"`, `"C:\\Pics\\beach_day.png"` → `"Beach day"`.
 */
export function prettyWallpaperName(name: string | null): string {
  const base = wallpaperBaseName(name);
  if (!base) return "Off";
  const raw = base.replace(/\.[^.]+$/, "");
  // Numbered sets ("wp (3)", "wallpaper_03") read as "Wallpaper 3".
  const numbered = /^(?:wp|wall|wallpaper|bg|background)[\s_-]*\(?0*(\d+)\)?$/i.exec(raw);
  if (numbered) return `Wallpaper ${numbered[1]}`;
  const stem = raw.replace(/^\d+[-_ ]?/, "");
  const words = stem.replace(/[-_]+/g, " ").trim();
  if (!words) return "Wallpaper";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
