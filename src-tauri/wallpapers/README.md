# Bundled wallpapers

These images ship with the app. The wallpaper picker in the slide menu reads
them at runtime — nothing is hardcoded, so you can add, remove, or update
wallpapers just by editing the files here (no code changes needed).

## Layout

```
wallpapers/
  light/   <- shown in light appearance
  dark/    <- shown in dark appearance
```

## Naming convention (important)

Each wallpaper is a **pair**: one file in `light/` and one file in `dark/`
that share the **exact same file name**. The shared name is the pairing key.

```
wallpapers/light/01-aurora.jpg
wallpapers/dark/01-aurora.jpg     <- same name = same wallpaper, dark variant
```

When the user switches appearance, the app keeps the current wallpaper but
swaps to the matching variant from the other folder.

Rules:

- A wallpaper only appears in the app if the **same file name exists in both
  `light/` and `dark/`**. Unpaired files are ignored.
- Wallpapers are listed in **alphabetical order** of file name. Use a numeric
  prefix (`01-`, `02-`, ...) to control the order.
- Supported extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, `.gif`.
- Do not rely on a fixed count or specific names anywhere — the app discovers
  whatever pairs are present.

## Adding a wallpaper

1. Drop `light/NN-name.jpg` and `dark/NN-name.jpg` (same name, both folders).
2. Rebuild / restart the app. It shows up automatically.
