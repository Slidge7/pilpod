/**
 * Sky — public surface for `App.tsx`: the page and its window label.
 *
 * Other features that only need to *open* the window import `./api` instead.
 * The page builds on the dashboard's hooks, so the dashboard importing this
 * index would close a module cycle; `api.ts` imports nothing from the page.
 */
export { SkyApp } from "./SkyApp";
export { SKY_LABEL } from "./constants";
export { openSkyWindow } from "./api";
