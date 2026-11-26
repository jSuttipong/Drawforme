import { useEffect, useRef, useState } from "react";

export default function NameDialog({ open, title, initial = "", confirmLabel = "Save", error, busy, theme, onSubmit, onClose }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue(initial);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [open, initial]);

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <div className={`dfm-overlay dfm-${theme}`} onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form className="dfm-dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{title}</h3>
        <input
          ref={inputRef}
          className="dfm-input"
          value={value}
          placeholder="Project name"
          maxLength={80}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && <div className="dfm-error">{error}</div>}
        <div className="dfm-dialog-actions">
          <button type="button" className="dfm-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="dfm-btn dfm-btn-primary" disabled={!value.trim() || busy}>
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
