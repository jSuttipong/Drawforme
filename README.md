# Vdea

A dark-mode whiteboard built with React + [Excalidraw](https://github.com/excalidraw/excalidraw), styled after excalidraw.com.

## Run

Requires Node.js 18+.

```
npm install
npm run dev
```

Or just double-click `start.bat`. The app opens at http://localhost:5173.

## Build for hosting

```
npm run build
```

Upload the `dist/` folder to any static host (Netlify, Vercel, GitHub Pages).

## Use it online (any device)

The app is published with GitHub Pages: **https://jsuttipong.github.io/Drawforme/**
(every push to `main` rebuilds it via `.github/workflows/deploy.yml`).

To save projects from any device, open ☰ → **Cloud sync (GitHub)…** and connect a private repo
(e.g. `Drawforme-save`) with a fine-grained token that has **Contents: Read and write** on that repo only.
Do this once per device/browser — the token stays in that browser. Every save is a commit in that repo:

- `save/<name>.excalidraw` – the drawing · `save/<name>.thumb.png` – preview
- `save/files/<id>.json` – images (uploaded once) · `save/index.json` – last-saved times

When the cloud is connected, the app on your PC uses it too, so every device sees the same projects.
To move an old local drawing to the cloud, use ☰ → **Import file…** and pick it from the `save` folder.

## Projects (save folder)

Open the menu (☰) → **Project list** to see all your drawings as cards. Click a card to open it;
hover a card to rename or delete it.

- Every project is stored in the `save/` folder as `<name>.excalidraw` (plus a `<name>.thumb.svg` preview).
  These are normal Excalidraw files, so they also open on excalidraw.com.
- The open project **auto-saves** about 1.5 s after you stop drawing. `Ctrl+S` saves right away.
- **New project**, **Save as…** (copy) and **Import file…** (copies a `.excalidraw` file into `save/`) are in the menu.
- The coloured dot next to the project name in the top-right: green = saved, yellow = saving, red = error.

> Saving to the folder works through the local server, so run the app with `npm run dev`
> (or `npm run build` + `npm run preview`). A plain static host can't write files.

## Text style (colour / underline / highlight words)

Double-click a text to edit it, drag over some words, then use the **Text style bar** at the bottom:

- **A ●●●** – colour the selected words (the crossed box = back to the normal colour)
- **U** – underline (or press `Ctrl+U`); click again to remove
- **Highlighter ●●●** – marker highlight behind the words
- **✕** – remove all styles from the selection

If a text box is just selected (not editing), the bar styles the whole text.
Styles stay attached to the words when you edit, move or rotate the text.
(Excalidraw text only supports one colour, so the styles are drawn with small locked helper
shapes that follow the text automatically.)

## Features

- Full Excalidraw editor (shapes, arrows, text, images, library, hand-drawn style)
- Thai text uses the Playpen Sans Thai font (loaded from Google Fonts, needs internet)
- Dark theme by default (toggle in the menu; your choice is remembered)
- Auto-saves your drawing to the browser's localStorage
- Open / save `.excalidraw` files, export PNG/SVG, quick "Export PNG" button
- Welcome screen and main menu like the official site
