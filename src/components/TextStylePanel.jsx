import { applyRichStyle, getStyles } from "../richText";

const TEXT_COLORS = ["#e03131", "#f08c00", "#2f9e44", "#1971c2", "#9c36b5", "#c2255c"];
const HIGHLIGHTS = ["#ffec99", "#b2f2bb", "#ffc9c9", "#a5d8ff", "#d0bfff"];

const getEditor = () => document.querySelector("textarea.excalidraw-wysiwyg");

// keep focus + selection inside the text editor when clicking the panel
const keep = (fn) => ({
  onPointerDown: (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 0) fn();
  },
  onMouseDown: (e) => e.preventDefault(),
});

export default function TextStylePanel({ api, target, theme, onToast }) {
  if (!api || !target) return null;

  const range = () => {
    const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === target.id);
    if (!el) return null;
    if (target.editing) {
      const ta = getEditor();
      if (!ta || ta.selectionStart === ta.selectionEnd) {
        onToast("Select some words first (drag over them while typing)");
        return null;
      }
      return [ta.selectionStart, ta.selectionEnd];
    }
    return [0, el.originalText.length]; // whole text box
  };

  const apply = (style) => {
    const r = range();
    if (r) applyRichStyle(api, target.id, r[0], r[1], style);
  };

  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === target.id);
  const hasStyles = getStyles(el).length > 0;

  return (
    <div className={`dfm-textbar dfm-tb-${theme}`} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
      <span className="dfm-textbar-hint">
        {target.editing ? "Style selected words" : "Style whole text"}
      </span>

      <div className="dfm-textbar-group" title="Text color">
        <span className="dfm-textbar-label">A</span>
        {TEXT_COLORS.map((c) => (
          <button key={c} className="dfm-swatch" style={{ background: c }} title={`Text color ${c}`} {...keep(() => apply({ kind: "color", color: c }))} />
        ))}
        <button className="dfm-swatch dfm-swatch-none" title="Default color" {...keep(() => apply({ kind: "color" }))} />
      </div>

      <div className="dfm-textbar-sep" />

      <button className="dfm-tool" title="Underline (Ctrl+U)" {...keep(() => apply({ kind: "underline", color: "auto" }))}>
        <span style={{ textDecoration: "underline", fontWeight: 700 }}>U</span>
      </button>

      <div className="dfm-textbar-sep" />

      <div className="dfm-textbar-group" title="Highlight">
        <span className="dfm-textbar-label">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l-5 5v3h3l5-5M9 11l6-6 4 4-6 6M9 11l4 4" /></svg>
        </span>
        {HIGHLIGHTS.map((c) => (
          <button key={c} className="dfm-swatch dfm-swatch-hl" style={{ background: c }} title={`Highlight ${c}`} {...keep(() => apply({ kind: "highlight", color: c }))} />
        ))}
        <button className="dfm-swatch dfm-swatch-none" title="No highlight" {...keep(() => apply({ kind: "highlight" }))} />
      </div>

      {(hasStyles || target.editing) && (
        <>
          <div className="dfm-textbar-sep" />
          <button className="dfm-tool" title="Remove all styles from the selection" {...keep(() => apply({ kind: "clear" }))}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </>
      )}
    </div>
  );
}
