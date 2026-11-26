// Use "Playpen Sans Thai" (Google Fonts) for Thai characters.
//
// Trick: we register extra @font-face rules under Excalidraw's own font family
// names, restricted to the Thai unicode range. The browser then uses Playpen
// Sans Thai only for Thai letters, while Latin text keeps Excalifont etc.

const CSS_URL = "https://fonts.googleapis.com/css2?family=Playpen+Sans+Thai:wght@400&display=swap";
const THAI_RANGE = "U+0E00-0E7F";
export const THAI_FAMILY = "Playpen Sans Thai";

// every font family Excalidraw can assign to a text element (+ the UI name)
const FAMILIES = [
  "Excalifont", "Virgil", "Nunito", "Lilita One", "Comic Shanns",
  "Helvetica", "Cascadia", "Liberation Sans", THAI_FAMILY,
];

let fontUrl = null;
let dataUrlPromise = null;

export async function loadThaiFont() {
  if (!("fonts" in document) || typeof FontFace === "undefined") return;
  try {
    const css = await fetch(CSS_URL).then((r) => r.text());
    const blocks = css.match(/@font-face\s*{[^}]*}/g) || [];
    // pick the Thai subset file
    // the Thai subset is the block whose range contains U+0E01 (ก)
    const thai = blocks.find((b) => /unicode-range:[^;]*U\+0E01\b/i.test(b));
    fontUrl = thai?.match(/url\((['"]?)(.*?)\1\)/)?.[2];
    if (!fontUrl) throw new Error("Thai subset not found");

    const faces = FAMILIES.map((family) => {
      const face = new FontFace(family, `url(${fontUrl}) format("woff2")`, {
        weight: "400",
        style: "normal",
        unicodeRange: THAI_RANGE,
        display: "swap",
      });
      document.fonts.add(face);
      return face.load();
    });
    // Excalidraw listens for "loadingdone" and redraws text automatically
    await Promise.all(faces);
  } catch (e) {
    console.warn("[thai-font] Could not load Playpen Sans Thai (offline?)", e);
  }
}

const hasThai = (s) => /[฀-๿]/.test(s || "");

const getDataUrl = () => {
  if (!dataUrlPromise) {
    dataUrlPromise = fetch(fontUrl)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = reject;
            fr.readAsDataURL(blob);
          })
      )
      .catch((e) => {
        dataUrlPromise = null;
        throw e;
      });
  }
  return dataUrlPromise;
};

// SVG exports (project thumbnails) can't load web fonts, so embed the Thai
// font into the SVG when the drawing contains Thai text.
export async function embedThaiFontInSvg(svg) {
  if (!fontUrl || !hasThai(svg.textContent)) return svg;
  try {
    const dataUrl = await getDataUrl();
    const ns = "http://www.w3.org/2000/svg";
    const style = document.createElementNS(ns, "style");
    style.textContent =
      `@font-face{font-family:"${THAI_FAMILY}";src:url(${dataUrl}) format("woff2");` +
      `unicode-range:${THAI_RANGE};}`;
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(ns, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    defs.appendChild(style);
    svg.querySelectorAll("text").forEach((t) => {
      const fam = t.getAttribute("font-family");
      if (!fam || fam.includes(THAI_FAMILY)) return;
      const [first, ...rest] = fam.split(",");
      t.setAttribute("font-family", [first, ` "${THAI_FAMILY}"`, ...rest].join(","));
    });
  } catch (e) {
    console.warn("[thai-font] Could not embed font in SVG", e);
  }
  return svg;
}
