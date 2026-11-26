import { useEffect, useState } from "react";
import { getGitHubConfig } from "../api";

export default function CloudDialog({ open, theme, storage, onClose, onConnect, onDisconnect }) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("Drawforme-save");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const cfg = getGitHubConfig();
    setOwner(cfg?.owner || "");
    setRepo(cfg?.repo || "Drawforme-save");
    setToken("");
    setError("");
  }, [open]);

  if (!open) return null;
  const connected = storage.mode === "github";

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const t = token.trim() || (connected ? getGitHubConfig()?.token : "");
    if (!owner.trim() || !repo.trim() || !t) return setError("Fill in your GitHub name, the repo and a token.");
    run(() => onConnect({ owner, repo, token: t }));
  };

  const newRepoUrl = `https://github.com/new?name=${encodeURIComponent(repo || "Drawforme-save")}&visibility=private`;

  return (
    <div className={`dfm-overlay dfm-${theme}`} onMouseDown={() => !busy && onClose()}>
      <form className="dfm-dialog dfm-cloud" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Cloud sync with GitHub</h3>
        <p className="dfm-muted">
          Save your projects in a <b>private GitHub repo</b>, so you can open and save them from any device.
          {connected && <><br />Now saving to <b>{storage.label.replace("GitHub · ", "")}</b>.</>}
          {!connected && storage.mode === "local" && <><br />Now saving to this computer's <b>save</b> folder.</>}
        </p>

        <ol className="dfm-steps">
          <li>
            <a href={newRepoUrl} target="_blank" rel="noreferrer">Create a private repo</a> (once), e.g. <code>Drawforme-save</code>.
          </li>
          <li>
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token</a>:
            Repository access → <i>Only select repositories</i> → your save repo; Permissions → <b>Contents: Read and write</b>.
          </li>
          <li>Paste it below. Do this once on each device.</li>
        </ol>

        <label className="dfm-field">
          <span>GitHub username</span>
          <input className="dfm-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="jSuttipong" autoFocus />
        </label>
        <label className="dfm-field">
          <span>Save repo</span>
          <input className="dfm-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="Drawforme-save" />
        </label>
        <label className="dfm-field">
          <span>Token</span>
          <input
            className="dfm-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connected ? "(keep current token)" : "github_pat_…"}
            autoComplete="off"
          />
        </label>
        <p className="dfm-muted dfm-small">The token is kept only in this browser.</p>

        {error && <div className="dfm-error">{error}</div>}
        <div className="dfm-dialog-actions">
          {connected && (
            <button type="button" className="dfm-btn dfm-btn-danger" disabled={busy} onClick={() => run(onDisconnect)}>
              Disconnect
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="dfm-btn" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="dfm-btn dfm-btn-primary" disabled={busy}>
            {busy ? "Connecting…" : connected ? "Save" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
