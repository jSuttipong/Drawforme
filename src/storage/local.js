// Storage backend: the local "save" folder, served by the Vite dev server
// (see server/projectsApi.js). Only available when running `npm run dev` / `preview`.
import { exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
import { embedThaiFontInSvg } from "../thaiFont";

const BASE = "/api/projects";
const enc = encodeURIComponent;

export const mode = "local";
export const describe = () => "This computer (save folder)";

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function available() {
  try {
    const res = await fetch(BASE, { cache: "no-store" });
    if (!res.ok) return false;
    return Array.isArray(await res.json());
  } catch {
    return false;
  }
}

export const listProjects = () => fetch(BASE, { cache: "no-store" }).then(json);
export const getProject = (id) => fetch(`${BASE}/${enc(id)}`, { cache: "no-store" }).then(json);
export const deleteProject = (id) => fetch(`${BASE}/${enc(id)}`, { method: "DELETE" }).then(json);
export const renameProject = (id, newId) =>
  fetch(`${BASE}/${enc(id)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newId }),
  }).then(json);

export async function saveProject(id, { elements, appState, files }, { create = false } = {}) {
  const scene = serializeAsJSON(elements, appState, files, "local");
  let thumbnail = "";
  if (elements.length) {
    try {
      const svg = await exportToSvg({
        elements,
        files,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: appState.theme === "dark" },
        exportPadding: 12,
      });
      thumbnail = (await embedThaiFontInSvg(svg)).outerHTML;
    } catch (e) {
      console.warn("Thumbnail failed", e);
    }
  }
  return fetch(`${BASE}/${enc(id)}${create ? "?create=1" : ""}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene, thumbnail }),
  }).then(json);
}

export const getThumb = async (p) => (p.hasThumb ? `${BASE}/${enc(p.id)}/thumb?t=${p.updatedAt}` : null);
