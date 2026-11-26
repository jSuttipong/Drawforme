const BASE = "/api/projects";
const enc = encodeURIComponent;

async function json(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const listProjects = () => fetch(BASE).then(json);
export const getProject = (id) => fetch(`${BASE}/${enc(id)}`).then(json);
export const deleteProject = (id) => fetch(`${BASE}/${enc(id)}`, { method: "DELETE" }).then(json);
export const renameProject = (id, newId) =>
  fetch(`${BASE}/${enc(id)}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newId }),
  }).then(json);
export const saveProject = (id, scene, thumbnail, { create = false } = {}) =>
  fetch(`${BASE}/${enc(id)}${create ? "?create=1" : ""}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scene, thumbnail }),
  }).then(json);
export const thumbUrl = (id, t) => `${BASE}/${enc(id)}/thumb?t=${t}`;

// Windows-safe file name
export const cleanName = (name) =>
  name
    .trim()
    .replace(/[^\p{L}\p{N}\p{M} _.()\-]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 80);
