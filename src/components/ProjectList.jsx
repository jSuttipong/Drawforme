import { useEffect, useMemo, useState } from "react";
import { listProjects, thumbUrl } from "../api";
import { CloseIcon, PencilIcon, PlusIcon, TrashIcon } from "./icons";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function timeAgo(ms) {
  const s = Math.round((ms - Date.now()) / 1000);
  const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
}

function Thumb({ project }) {
  const [failed, setFailed] = useState(false);
  if (!project.hasThumb || failed) return <div className="dfm-thumb-empty">Empty</div>;
  return <img src={thumbUrl(project.id, project.updatedAt)} alt="" onError={() => setFailed(true)} draggable={false} />;
}

export default function ProjectList({ open, theme, current, refreshKey, onClose, onOpen, onNew, onRename, onDelete }) {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    listProjects()
      .then(setProjects)
      .catch((e) => setError(`Couldn't load projects: ${e.message}`));
  }, [open, refreshKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shown = useMemo(
    () => (projects || []).filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
    [projects, query]
  );

  if (!open) return null;

  return (
    <div className={`dfm-overlay dfm-${theme}`} onMouseDown={onClose}>
      <div className="dfm-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dfm-panel-header">
          <h2>Project list</h2>
          <span className="dfm-count">{projects ? projects.length : "…"}</span>
          <input
            className="dfm-input dfm-search"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button className="dfm-btn dfm-btn-primary" onClick={onNew}>
            <PlusIcon /> New
          </button>
          <button className="dfm-icon-btn" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>

        {error && <div className="dfm-error">{error}</div>}

        <div className="dfm-grid">
          {projects && shown.length === 0 && (
            <div className="dfm-empty">
              {projects.length === 0 ? "No projects yet — click “New” to create one." : "No projects match your search."}
            </div>
          )}
          {shown.map((p) => (
            <div
              key={p.id}
              className={`dfm-card${p.id === current ? " is-current" : ""}`}
              onClick={() => onOpen(p.id)}
              title={`Open “${p.name}”`}
            >
              <div className="dfm-thumb">
                <Thumb project={p} />
              </div>
              <div className="dfm-card-body">
                <div className="dfm-card-name">{p.name}</div>
                <div className="dfm-card-meta">
                  {p.id === current ? <span className="dfm-badge">Open</span> : null}
                  {timeAgo(p.updatedAt)}
                </div>
              </div>
              <div className="dfm-card-actions">
                <button
                  className="dfm-icon-btn"
                  title="Rename"
                  onClick={(e) => { e.stopPropagation(); onRename(p.id); }}
                >
                  <PencilIcon />
                </button>
                <button
                  className="dfm-icon-btn danger"
                  title="Delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(p.id); }}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
