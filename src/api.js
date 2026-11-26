// Picks where projects are saved:
//   - GitHub repo (if connected)  -> works from any device, incl. GitHub Pages
//   - local "save" folder         -> when running `npm run dev` on your PC
import * as local from "./storage/local";
import * as github from "./storage/github";

let backend = null;

const info = () => (backend ? { mode: backend.mode, label: backend.describe() } : { mode: "none", label: "" });

export async function initStorage() {
  const cfg = github.getConfig();
  if (cfg) {
    backend = github;
    try {
      await github.connect(cfg);
      return info();
    } catch (e) {
      return { ...info(), error: `GitHub sync: ${e.message}` };
    }
  }
  backend = (await local.available()) ? local : null;
  return info();
}

export async function connectGitHub(cfg) {
  await github.connect(cfg);
  backend = github;
  return info();
}

export async function disconnectGitHub() {
  github.clearConfig();
  backend = (await local.available()) ? local : null;
  return info();
}

export const getGitHubConfig = github.getConfig;

function need() {
  if (!backend) {
    throw Object.assign(new Error("Nowhere to save yet — open ☰ → Cloud sync (GitHub) to connect."), { status: 0 });
  }
  return backend;
}

export const listProjects = (...a) => need().listProjects(...a);
export const getProject = (...a) => need().getProject(...a);
export const saveProject = (...a) => need().saveProject(...a);
export const deleteProject = (...a) => need().deleteProject(...a);
export const renameProject = (...a) => need().renameProject(...a);
export const getThumb = (p) => (backend ? backend.getThumb(p) : Promise.resolve(null));

// Windows-safe file name
export const cleanName = (name) =>
  name
    .trim()
    .replace(/[^\p{L}\p{N}\p{M} _.()\-]/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .slice(0, 80);
