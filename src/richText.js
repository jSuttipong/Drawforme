// "Rich text" for Excalidraw text elements.
//
// Excalidraw text boxes have a single colour, so styles are stored on the text
// element (customData.richStyles = [{kind, color, start, end}], indexes into
// originalText) and drawn with extra *locked* helper elements:
//   highlight -> solid rectangle behind the words
//   color     -> background-coloured mask + a coloured copy of the words
//   underline -> a line under the words
// Helpers carry customData.dfmDecor = <text id> and are rebuilt whenever the
// text moves, changes, rotates or is restyled.
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";

const FAMILY = { 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito", 7: "Lilita One", 8: "Comic Shanns", 9: "Liberation Sans" };
// [unitsPerEm, ascender, descender] — same numbers Excalidraw uses
const METRICS = {
  1: [1000, 886, -374], 5: [1000, 886, -374], 6: [1000, 1011, -353], 7: [1000, 923, -220],
  8: [1000, 750, -250], 2: [2048, 1577, -471], 3: [2048, 1900, -480], 9: [2048, 1854, -434],
};

const ctx = document.createElement("canvas").getContext("2d");
const fontString = (el) =>
  `${el.fontSize}px ${FAMILY[el.fontFamily] || "Excalifont"}, ${el.fontFamily === 5 ? "Xiaolai, " : ""}Segoe UI Emoji`;
const measure = (el, s) => {
  ctx.font = fontString(el);
  return s ? ctx.measureText(s).width : 0;
};
const lineHeightPx = (el) => el.fontSize * el.lineHeight;
const baseline = (el) => {
  const [upm, asc, desc] = METRICS[el.fontFamily] || METRICS[1];
  const a = el.fontSize / upm;
  return a * asc + (lineHeightPx(el) - a * asc + a * desc) / 2;
};

export const getStyles = (el) => el?.customData?.richStyles || [];
export const isDecor = (el) => !!el?.customData?.dfmDecor;

// ---------- index helpers ----------

// map every index of originalText to {line, col} in the wrapped `text`
function indexMap(orig, text) {
  const map = new Array(orig.length + 1);
  let j = 0, line = 0, col = 0;
  for (let i = 0; i < orig.length; i++) {
    while (j < text.length && text[j] !== orig[i] && text[j] === "\n") {
      j++; line++; col = 0;
    }
    map[i] = { line, col };
    if (j < text.length && text[j] === orig[i]) {
      if (orig[i] === "\n") { line++; col = 0; } else col++;
      j++;
    } // else: whitespace removed by wrapping — stays on the same spot
  }
  map[orig.length] = { line, col };
  return map;
}

// keep style ranges attached to the right words after the text was edited
function shiftStyles(styles, oldText, newText) {
  if (oldText === newText || oldText == null) return styles;
  let p = 0;
  while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < oldText.length - p && s < newText.length - p &&
         oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  const oldEnd = oldText.length - s, newEnd = newText.length - s, delta = newEnd - oldEnd;
  const insertion = oldEnd === p;
  const mapPos = (x, isEnd) => {
    if (x < p || (x === p && !(isEnd && insertion))) return x;
    if (x >= oldEnd) return x + delta;
    return isEnd ? newEnd : p;
  };
  return styles
    .map((st) => {
      // typing inside a styled word extends the style
      if (insertion && st.start < p && st.end > p) return { ...st, end: st.end + delta };
      return { ...st, start: mapPos(st.start, false), end: mapPos(st.end, true) };
    })
    .filter((st) => st.end > st.start);
}

// styles aligned with the element's current text
const currentStyles = (el) =>
  shiftStyles(getStyles(el), el.customData?.richText ?? el.originalText, el.originalText);

const subtract = (styles, start, end, kinds) =>
  styles.flatMap((st) => {
    if (!kinds.includes(st.kind) || st.end <= start || st.start >= end) return [st];
    const out = [];
    if (st.start < start) out.push({ ...st, end: start });
    if (st.end > end) out.push({ ...st, start: end });
    return out;
  });

const covered = (styles, start, end, kind) => {
  for (let i = start; i < end; i++)
    if (!styles.some((st) => st.kind === kind && st.start <= i && st.end > i)) return false;
  return true;
};

// ---------- geometry ----------

function segments(el, start, end) {
  const lines = el.text.split("\n");
  const map = indexMap(el.originalText, el.text);
  const a = map[Math.max(0, Math.min(start, el.originalText.length))];
  const b = map[Math.max(0, Math.min(end, el.originalText.length))];
  const lh = lineHeightPx(el);
  const out = [];
  for (let L = a.line; L <= b.line && L < lines.length; L++) {
    const line = lines[L];
    const c0 = L === a.line ? a.col : 0;
    const c1 = Math.min(L === b.line ? b.col : line.length, line.length);
    if (c1 <= c0) continue;
    const lineW = measure(el, line);
    const off = el.textAlign === "center" ? (el.width - lineW) / 2 : el.textAlign === "right" ? el.width - lineW : 0;
    out.push({
      x: el.x + off + measure(el, line.slice(0, c0)),
      y: el.y + L * lh,
      w: measure(el, line.slice(c0, c1)),
      h: lh,
      str: line.slice(c0, c1),
    });
  }
  return out;
}

// rotate a box around the text's centre so helpers follow rotated text
function place(el, x, y, w, h) {
  if (!el.angle) return { x, y, angle: 0 };
  const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
  const bx = x + w / 2 - cx, by = y + h / 2 - cy;
  const cos = Math.cos(el.angle), sin = Math.sin(el.angle);
  return { x: cx + bx * cos - by * sin - w / 2, y: cy + bx * sin + by * cos - h / 2, angle: el.angle };
}

function buildDecor(el, styles, bgColor, key) {
  const meta = (kind) => ({ locked: true, opacity: el.opacity, customData: { dfmDecor: el.id, kind, key } });
  const lh = lineHeightPx(el);
  const below = [], masks = [], overlays = [], lines = [];
  const highlightAt = (i) => styles.find((st) => st.kind === "highlight" && st.start <= i && st.end > i);

  for (const st of styles) {
    for (const seg of segments(el, st.start, st.end)) {
      if (st.kind === "highlight") {
        const w = seg.w + 4, h = lh * 0.84, p = place(el, seg.x - 2, seg.y + lh * 0.08, w, h);
        below.push({ type: "rectangle", ...p, width: w, height: h, backgroundColor: st.color, fillStyle: "solid",
          strokeColor: "transparent", strokeWidth: 1, roughness: 0, roundness: { type: 3 }, ...meta("highlight") });
      } else if (st.kind === "color") {
        const hl = highlightAt(st.start);
        const mw = seg.w + 2, mp = place(el, seg.x - 1, seg.y, mw, lh);
        masks.push({ type: "rectangle", ...mp, width: mw, height: lh, backgroundColor: hl ? hl.color : bgColor,
          fillStyle: "solid", strokeColor: "transparent", strokeWidth: 1, roughness: 0, roundness: null, ...meta("mask") });
        const tp = place(el, seg.x, seg.y, seg.w, lh);
        overlays.push({ type: "text", ...tp, text: seg.str, fontSize: el.fontSize, fontFamily: el.fontFamily,
          lineHeight: el.lineHeight, textAlign: "left", verticalAlign: "top", strokeColor: st.color, ...meta("color") });
      } else if (st.kind === "underline") {
        const uy = seg.y + baseline(el) + el.fontSize * 0.12;
        const sw = Math.max(1, Math.round(el.fontSize / 16));
        const lp = place(el, seg.x, uy, seg.w, 0);
        lines.push({ type: "line", ...lp, points: [[0, 0], [seg.w, 0]], strokeColor: st.color, strokeWidth: sw,
          roughness: 1, ...meta("underline") });
      }
    }
  }
  const conv = (arr) => (arr.length ? convertToExcalidrawElements(arr, { regenerateIds: true }) : []);
  return { below: conv(below), above: [...conv(masks), ...conv(overlays), ...conv(lines)] };
}

const keyOf = (el, styles, bg) =>
  JSON.stringify([el.text, el.originalText, el.x, el.y, el.width, el.height, el.fontSize, el.fontFamily,
    el.lineHeight, el.textAlign, el.angle, el.opacity, styles, bg]);

const maskColor = (el, all, appState) => {
  const c = el.containerId && all.find((e) => e.id === el.containerId);
  return c && c.backgroundColor && c.backgroundColor !== "transparent" ? c.backgroundColor : appState.viewBackgroundColor;
};

// ---------- public API ----------

// Rebuild helper elements where needed. Cheap when nothing changed.
export function syncRichText(api) {
  const all = api.getSceneElementsIncludingDeleted();
  const appState = api.getAppState();
  const bases = new Map();
  for (const e of all) if (!e.isDeleted && e.type === "text" && getStyles(e).length) bases.set(e.id, e);

  const decorByBase = new Map();
  let orphan = false;
  for (const e of all) {
    if (!isDecor(e)) continue;
    if (e.isDeleted || !bases.has(e.customData.dfmDecor)) { orphan = true; continue; }
    const list = decorByBase.get(e.customData.dfmDecor) || [];
    list.push(e);
    decorByBase.set(e.customData.dfmDecor, list);
  }

  const rebuild = new Map(); // id -> {base, below, above}
  for (const el of bases.values()) {
    const styles = currentStyles(el);
    const bg = maskColor(el, all, appState);
    const key = keyOf(el, styles, bg);
    const existing = decorByBase.get(el.id) || [];
    const textChanged = (el.customData.richText ?? el.originalText) !== el.originalText;
    if (!textChanged && existing.length && existing.every((d) => d.customData.key === key)) continue;
    let base = el;
    if (textChanged || styles.length !== getStyles(el).length) {
      base = newElementWith(el, { customData: { ...el.customData, richStyles: styles, richText: el.originalText } });
    }
    rebuild.set(el.id, { base, ...buildDecor(base, styles, bg, key) });
  }
  if (!orphan && rebuild.size === 0) return;

  const out = [];
  for (const e of all) {
    if (isDecor(e)) {
      if (e.isDeleted || !bases.has(e.customData.dfmDecor) || rebuild.has(e.customData.dfmDecor)) continue;
      out.push(e);
    } else if (rebuild.has(e.id)) {
      const r = rebuild.get(e.id);
      out.push(...r.below, r.base, ...r.above);
    } else out.push(e);
  }
  api.updateScene({ elements: out, captureUpdate: CaptureUpdateAction.NEVER });
}

// Apply a style to [start, end) of a text element.
// style: { kind: "color" | "underline" | "highlight" | "clear", color? }
export function applyRichStyle(api, textId, start, end, style) {
  const all = api.getSceneElementsIncludingDeleted();
  const el = all.find((e) => e.id === textId);
  if (!el || el.type !== "text" || end <= start) return false;
  let styles = currentStyles(el);

  if (style.kind === "clear") {
    styles = subtract(styles, start, end, ["color", "underline", "highlight"]);
  } else if (style.kind === "underline" && covered(styles, start, end, "underline")) {
    styles = subtract(styles, start, end, ["underline"]); // toggle off
  } else {
    styles = subtract(styles, start, end, [style.kind]);
    if (style.color) {
      let color = style.color;
      if (style.kind === "underline" && color === "auto") {
        color = styles.find((st) => st.kind === "color" && st.start <= start && st.end > start)?.color || el.strokeColor;
      }
      styles.push({ kind: style.kind, color, start, end });
    }
  }
  styles.sort((a, b) => a.start - b.start);
  const updated = newElementWith(el, {
    customData: { ...el.customData, richStyles: styles, richText: el.originalText },
  });
  api.updateScene({
    elements: all.map((e) => (e.id === textId ? updated : e)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  syncRichText(api);
  return true;
}
