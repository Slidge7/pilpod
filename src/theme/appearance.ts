export const THEME_STORAGE_KEY = "pilpod-theme";

export type AppearanceMode = "light" | "dark";

export function readStoredAppearance(): AppearanceMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light") return "light";
    if (raw === "dark") return "dark";
  } catch {
    /* private mode / SSR */
  }
  return "dark";
}

export function applyAppearance(mode: AppearanceMode): void {
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme =
    mode === "dark" ? "dark" : "light";
}

export function persistAppearance(mode: AppearanceMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
