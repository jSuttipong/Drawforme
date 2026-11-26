// Storage backend: a GitHub repository (works on any device, incl. GitHub Pages).
//
// Layout inside the repo:
//   save/<name>.excalidraw     drawing (without embedded images)
//   save/<name>.thumb.png      small preview for the Project list
//   save/files/<fileId>.json   images, uploaded once and shared between saves
//   save/index.json            { "<name>": { updatedAt } }
//
// Every save is ONE commit (Git Data API), so history stays readable.
import { exportToBlob, serializeAsJSON } from "@excalidraw/excalidraw";

const API = "https://api.github.com";
const KEY = "vdea-github";
const DIR = "save";
const INDEX = `${DIR}/index.json`;

export const mode = "github";

let cfg = null; // { owner, repo, token, branch }
let head = null; // { commit, tree }
let paths = new Map(); // path -> { sha, size }
let index = {};
let queue = Promise.resolve();
const thumbCache = new Map(); // blob sha -> object URL

export const getConfig = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
};
export const describe = () => (cfg ? `GitHub · ${cfg.owner}/${cfg.repo}` : "GitHub");
export function clearConfig() {
  localStorage.removeItem(KEY);
  cfg = null;
  head = null;
  paths = new Map();
  index = {};
}

const scenePath = (id) => `${DIR}/${id}.excalidraw`;
const thumbPath = (id) => `${DIR}/${id}.thumb.png`;
const filePath = (fileId) => `${DIR}/files/${fileId}.json`;
const R = () => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

const err = (message, status) => Object.assign(new Error(message), { status });

function friendly(status, msg) {
  if (status === 401) return "GitHub token is invalid or expired. Create a new one in ☰ → Cloud sync.";
  if (status === 403 && /rate limit/i.test(msg)) return "GitHub rate limit reached — try again in a few minutes.";
  if (status === 403) return "The token isn't allowed to change this repo (it needs Contents: Read and write).";
  if (status === 404) return "Repo not found — check the name, and that the token has access to it.";
  return `GitHub: ${msg}`;
}

async function gh(path, { method = "GET", body, accept, as = "json" } = {}) {
  const res = await fetch(API + path, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      /* ignore */
    }
    throw err(friendly(res.status, msg), res.status);
  }
  if (res.status === 204) return null;
  if (as === "text") return res.text();
  if (as === "blob") return res.blob();
  return res.json();
}

const RAW = "application/vnd.github.raw+json";
const readBlob = (sha, as = "text") => gh(`${R()}/git/blobs/${sha}`, { accept: RAW, as });

// run GitHub operations one at a time so saves never race each other
function enqueue(fn) {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

async function loadHead() {
  const refPath = `${R()}/git/ref/heads/${encodeURIComponent(cfg.branch)}`;
  let ref;
  try {
    ref = await gh(refPath);
  } catch (e) {
    if (e.status !== 409 && e.status !== 404) throw e;
    // empty repo: create the save folder with a first commit
    await gh(`${R()}/contents/${INDEX}`, {
      method: "PUT",
      body: { message: "Create Vdea save folder", content: btoa("{}\n") },
    });
    const repo = await gh(R());
    cfg.branch = repo.default_branch || cfg.branch;
    ref = await gh(`${R()}/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
  }
  const commit = await gh(`${R()}/git/commits/${ref.object.sha}`);
  const tree = await gh(`${R()}/git/trees/${commit.tree.sha}?recursive=1`);
  head = { commit: ref.object.sha, tree: commit.tree.sha };
  paths = new Map(
    tree.tree
      .filter((t) => t.type === "blob" && t.path.startsWith(`${DIR}/`))
      .map((t) => [t.path, { sha: t.sha, size: t.size }])
  );
  index = {};
  const idx = paths.get(INDEX);
  if (idx) {
    try {
      index = JSON.parse(await readBlob(idx.sha)) || {};
    } catch {
      index = {};
    }
  }
}

// build() -> { changes: [{ path, content, encoding } | { path, sha } | { path, delete: true }], nextIndex? }
function commitChanges(message, build) {
  return enqueue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!head) await loadHead();
      const { changes, nextIndex } = build();
      const entries = [];
      const next = new Map(paths);
      for (const ch of changes) {
        if (ch.delete) {
          if (paths.has(ch.path)) {
            entries.push({ path: ch.path, mode: "100644", type: "blob", sha: null });
            next.delete(ch.path);
          }
          continue;
        }
        let sha = ch.sha;
        if (!sha) {
          const blob = await gh(`${R()}/git/blobs`, {
            method: "POST",
            body: { content: ch.content, encoding: ch.encoding || "utf-8" },
          });
          sha = blob.sha;
        }
        entries.push({ path: ch.path, mode: "100644", type: "blob", sha });
        next.set(ch.path, { sha });
      }
      if (nextIndex) {
        const blob = await gh(`${R()}/git/blobs`, {
          method: "POST",
          body: { content: JSON.stringify(nextIndex, null, 1) + "\n", encoding: "utf-8" },
        });
        entries.push({ path: INDEX, mode: "100644", type: "blob", sha: blob.sha });
        next.set(INDEX, { sha: blob.sha });
      }
      if (!entries.length) return;

      const tree = await gh(`${R()}/git/trees`, { method: "POST", body: { base_tree: head.tree, tree: entries } });
      const commit = await gh(`${R()}/git/commits`, {
        method: "POST",
        body: { message, tree: tree.sha, parents: [head.commit] },
      });
      try {
        await gh(`${R()}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, {
          method: "PATCH",
          body: { sha: commit.sha, force: false },
        });
      } catch (e) {
        // another device saved in the meantime: reload and try again
        if (e.status === 422 && attempt < 2) {
          head = null;
          continue;
        }
        throw e;
      }
      head = { commit: commit.sha, tree: tree.sha };
      paths = next;
      if (nextIndex) index = nextIndex;
      return;
    }
  });
}

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

// ---------- public API ----------

export async function connect({ owner, repo, token }) {
  cfg = { owner: owner.trim(), repo: repo.trim(), token: token.trim(), branch: "main" };
  head = null;
  const info = await gh(R());
  if (info.permissions && info.permissions.push === false) {
    throw err("This token can read the repo but not save to it. Give it Contents: Read and write.", 403);
  }
  cfg.branch = info.default_branch || "main";
  await enqueue(loadHead);
  localStorage.setItem(KEY, JSON.stringify({ owner: cfg.owner, repo: cfg.repo, token: cfg.token }));
}

export async function listProjects() {
  await enqueue(loadHead); // pick up projects saved on other devices
  const out = [];
  for (const [p, v] of paths) {
    const m = p.match(/^save\/([^/]+)\.excalidraw$/);
    if (!m) continue;
    const id = m[1];
    const thumb = paths.get(thumbPath(id)) || paths.get(`${DIR}/${id}.thumb.svg`);
    out.push({
      id,
      name: id,
      size: v.size,
      updatedAt: index[id]?.updatedAt || 0,
      hasThumb: !!thumb,
      thumbSha: thumb?.sha,
      thumbType: paths.has(thumbPath(id)) ? "image/png" : "image/svg+xml",
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  return out;
}

export async function getThumb(p) {
  if (!p.thumbSha) return null;
  if (!thumbCache.has(p.thumbSha)) {
    const blob = await readBlob(p.thumbSha, "blob");
    thumbCache.set(p.thumbSha, URL.createObjectURL(new Blob([blob], { type: p.thumbType })));
  }
  return thumbCache.get(p.thumbSha);
}

export async function getProject(id) {
  await enqueue(loadHead);
  const entry = paths.get(scenePath(id));
  if (!entry) throw err("Project not found", 404);
  const data = JSON.parse(await readBlob(entry.sha));
  const files = { ...(data.files || {}) };
  const needed = new Set((data.elements || []).filter((e) => e.fileId && !e.isDeleted).map((e) => e.fileId));
  await Promise.all(
    [...needed]
      .filter((fid) => !files[fid] && paths.has(filePath(fid)))
      .map(async (fid) => {
        files[fid] = JSON.parse(await readBlob(paths.get(filePath(fid)).sha));
      })
  );
  return { ...data, files };
}

export async function saveProject(id, { elements, appState, files }, { create = false } = {}) {
  const scene = serializeAsJSON(elements, appState, {}, "local"); // images are stored separately
  const used = [...new Set(elements.filter((e) => e.fileId).map((e) => e.fileId))].filter((f) => files[f]);

  let thumb = null;
  if (elements.length) {
    try {
      const blob = await exportToBlob({
        elements,
        files,
        appState: { ...appState, exportBackground: true, exportWithDarkMode: appState.theme === "dark" },
        mimeType: "image/png",
        maxWidthOrHeight: 480,
        exportPadding: 12,
      });
      thumb = await blobToBase64(blob);
    } catch (e) {
      console.warn("Thumbnail failed", e);
    }
  }

  await commitChanges(`Save ${id}`, () => {
    if (create && paths.has(scenePath(id))) throw err("A project with that name already exists", 409);
    const changes = [{ path: scenePath(id), content: scene }];
    for (const fid of used) {
      if (!paths.has(filePath(fid))) changes.push({ path: filePath(fid), content: JSON.stringify(files[fid]) });
    }
    if (thumb) changes.push({ path: thumbPath(id), content: thumb, encoding: "base64" });
    else changes.push({ path: thumbPath(id), delete: true });
    return { changes, nextIndex: { ...index, [id]: { updatedAt: Date.now() } } };
  });
  return { ok: true, id };
}

export async function deleteProject(id) {
  await commitChanges(`Delete ${id}`, () => {
    const nextIndex = { ...index };
    delete nextIndex[id];
    return {
      changes: [
        { path: scenePath(id), delete: true },
        { path: thumbPath(id), delete: true },
        { path: `${DIR}/${id}.thumb.svg`, delete: true },
      ],
      nextIndex,
    };
  });
  return { ok: true };
}

export async function renameProject(id, newId) {
  await commitChanges(`Rename ${id} → ${newId}`, () => {
    const scene = paths.get(scenePath(id));
    if (!scene) throw err("Project not found", 404);
    if (newId === id) return { changes: [] };
    if (newId !== id && paths.has(scenePath(newId))) throw err("A project with that name already exists", 409);
    const changes = [
      { path: scenePath(newId), sha: scene.sha },
      { path: scenePath(id), delete: true },
    ];
    const t = paths.get(thumbPath(id));
    if (t) changes.push({ path: thumbPath(newId), sha: t.sha }, { path: thumbPath(id), delete: true });
    const nextIndex = { ...index, [newId]: index[id] || { updatedAt: Date.now() } };
    delete nextIndex[id];
    return { changes, nextIndex };
  });
  return { ok: true, id: newId };
}
