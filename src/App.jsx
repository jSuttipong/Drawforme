import { useCallback, useEffect, useRef, useState } from "react";
import {
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  exportToBlob,
  exportToSvg,
  serializeAsJSON,
  restoreElements,
  loadFromBlob,
} from "@excalidraw/excalidraw";
import {
  cleanName,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
  saveProject,
} from "./api";
import { embedThaiFontInSvg } from "./thaiFont";
import { applyRichStyle, syncRichText } from "./richText";
import TextStylePanel from "./components/TextStylePanel";
import ProjectList from "./components/ProjectList";
import NameDialog from "./components/NameDialog";
import { CopyIcon, FolderIcon, PlusIcon, SaveIcon, UploadIcon } from "./components/icons";

const STORAGE_KEY = "vdea-scene";
const CURRENT_KEY = "vdea-current-project";

// carry over browser data saved under the old app name (Drawforme)
try {
  [["drawforme-scene", STORAGE_KEY], ["drawforme-current-project", CURRENT_KEY]].forEach(([oldKey, newKey]) => {
    const v = localStorage.getItem(oldKey);
    if (v !== null && localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v);
    localStorage.removeItem(oldKey);
  });
} catch {
  /* storage unavailable */
}
const AUTOSAVE_MS = 1500;

// appState keys worth keeping in the browser between visits
const PERSIST_KEYS = [
  "theme", "viewBackgroundColor", "currentItemStrokeColor", "currentItemBackgroundColor",
  "currentItemFillStyle", "currentItemStrokeWidth", "currentItemStrokeStyle", "currentItemRoughness",
  "currentItemOpacity", "currentItemFontFamily", "currentItemFontSize", "currentItemTextAlign",
  "currentItemRoundness", "currentItemArrowType", "gridModeEnabled", "zenModeEnabled",
  "scrollX", "scrollY", "zoom",
];

function loadLocalScene() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        elements: data.elements || [],
        files: data.files || {},
        appState: { theme: "dark", ...(data.appState || {}) },
        scrollToContent: false,
      };
    }
  } catch (e) {
    console.warn("Could not load saved scene", e);
  }
  return { elements: [], files: {}, appState: { theme: "dark", viewBackgroundColor: "#ffffff" } };
}

// cheap fingerprint to detect real changes (onChange also fires on pan/zoom/selection)
const sceneVersion = (elements, files) =>
  `${elements.length}:${elements.reduce((a, e) => a + e.version, 0)}:${Object.keys(files || {}).length}`;

const uniqueName = (base, taken) => {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
};

export default function App() {
  const [api, setApi] = useState(null);
  const [initialData] = useState(loadLocalScene);
  const [theme, setTheme] = useState(initialData.appState.theme || "dark");
  const [current, setCurrentState] = useState(() => localStorage.getItem(CURRENT_KEY));
  const [status, setStatus] = useState("saved"); // saved | unsaved | saving | error
  const [showList, setShowList] = useState(false);
  const [listKey, setListKey] = useState(0);
  const [dialog, setDialog] = useState(null); // { mode, initial, target }
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);

  const currentRef = useRef(current);
  const savedVersion = useRef(null);
  const localTimer = useRef(null);
  const serverTimer = useRef(null);
  const fileInput = useRef(null);
  const apiRef = useRef(null);
  const syncFrame = useRef(0);
  const [textTarget, setTextTarget] = useState(null); // { id, editing }
  apiRef.current = api;
  if (import.meta.env.DEV) window.__vdea = api; // handy for debugging in the console

  const setCurrent = (id) => {
    currentRef.current = id;
    setCurrentState(id);
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  };

  const toast = (message, duration = 2500) => api?.setToast({ message, duration });

  // ---------- saving ----------
  const writeToServer = useCallback(
    async (id, { create = false } = {}) => {
      const all = api.getSceneElementsIncludingDeleted();
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const version = sceneVersion(all, files);

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
      await saveProject(id, scene, thumbnail, { create });
      savedVersion.current = version;
    },
    [api]
  );

  const saveCurrentNow = useCallback(async () => {
    clearTimeout(serverTimer.current);
    const id = currentRef.current;
    if (!api || !id) return;
    setStatus("saving");
    try {
      await writeToServer(id);
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      toast(`Save failed: ${e.message}`, 4000);
    }
  }, [api, writeToServer]); // eslint-disable-line react-hooks/exhaustive-deps

  // save pending changes before switching project
  const flush = async () => {
    if (serverTimer.current && currentRef.current) await saveCurrentNow();
    clearTimeout(serverTimer.current);
    serverTimer.current = null;
  };

  const handleChange = useCallback(
    (elements, appState, files) => {
      setTheme((t) => (t === appState.theme ? t : appState.theme));

      // which text element the "Text style" bar should act on
      let target = null;
      const editing = appState.editingTextElement;
      if (editing && editing.type === "text") target = { id: editing.id, editing: true };
      else {
        const ids = Object.keys(appState.selectedElementIds || {});
        if (ids.length === 1) {
          const el = elements.find((e) => e.id === ids[0]);
          if (el?.type === "text") target = { id: el.id, editing: false };
          else {
            const bound = el?.boundElements?.find((b) => b.type === "text");
            if (bound) target = { id: bound.id, editing: false };
          }
        }
      }
      setTextTarget((t) =>
        t?.id === target?.id && t?.editing === target?.editing ? t : target
      );

      // keep coloured / underlined / highlighted words in place
      cancelAnimationFrame(syncFrame.current);
      syncFrame.current = requestAnimationFrame(() => {
        if (apiRef.current) syncRichText(apiRef.current);
      });

      // browser backup of whatever is on the canvas
      clearTimeout(localTimer.current);
      localTimer.current = setTimeout(() => {
        try {
          const state = {};
          PERSIST_KEYS.forEach((k) => appState[k] !== undefined && (state[k] = appState[k]));
          const live = elements.filter((el) => !el.isDeleted);
          const used = new Set(live.map((el) => el.fileId).filter(Boolean));
          const usedFiles = Object.fromEntries(Object.entries(files || {}).filter(([id]) => used.has(id)));
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ elements: live, appState: state, files: usedFiles }));
        } catch (e) {
          console.warn("Local backup failed (storage may be full)", e);
        }
      }, 300);

      // autosave into save/<project>.excalidraw
      if (!currentRef.current) return;
      const v = sceneVersion(elements, files);
      if (savedVersion.current === null) savedVersion.current = v;
      if (v === savedVersion.current) return;
      setStatus("unsaved");
      clearTimeout(serverTimer.current);
      serverTimer.current = setTimeout(() => {
        serverTimer.current = null;
        saveCurrentNow();
      }, AUTOSAVE_MS);
    },
    [saveCurrentNow]
  );

  // ---------- loading ----------
  const putOnCanvas = useCallback(
    ({ elements, appState = {}, files = {} }) => {
      const themeNow = api.getAppState().theme;
      api.resetScene();
      const fileList = Object.values(files || {});
      if (fileList.length) api.addFiles(fileList);
      api.updateScene({
        elements,
        appState: {
          theme: themeNow,
          viewBackgroundColor: appState.viewBackgroundColor || "#ffffff",
          gridModeEnabled: !!appState.gridModeEnabled,
        },
      });
      api.history?.clear?.();
      if (elements.length) api.scrollToContent(elements, { fitToContent: true, animate: false });
      savedVersion.current = sceneVersion(api.getSceneElementsIncludingDeleted(), api.getFiles());
    },
    [api]
  );

  const openProject = useCallback(
    async (id, { silent = false } = {}) => {
      try {
        const data = await getProject(id);
        const elements = restoreElements(data.elements || [], null);
        putOnCanvas({ elements, appState: data.appState, files: data.files });
        setCurrent(id);
        setStatus("saved");
        if (!silent) toast(`Opened “${id}”`);
        return true;
      } catch (e) {
        if (e.status === 404 && currentRef.current === id) setCurrent(null);
        if (!silent) toast(`Couldn't open “${id}”: ${e.message}`, 4000);
        return false;
      }
    },
    [putOnCanvas] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // reopen last project on start
  useEffect(() => {
    if (api && currentRef.current) openProject(currentRef.current, { silent: true });
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- actions ----------
  const handleOpenFromList = async (id) => {
    setShowList(false);
    if (id === currentRef.current) return;
    await flush();
    await openProject(id);
  };

  const askName = (mode, initial = "", target = null) => {
    setDialogError("");
    setDialog({ mode, initial, target });
  };

  const handleSaveShortcut = async () => {
    if (currentRef.current) {
      await saveCurrentNow();
      toast(`Saved “${currentRef.current}”`, 1500);
    } else {
      askName("save", "Untitled");
    }
  };

  const handleDialogSubmit = async (raw) => {
    const name = cleanName(raw);
    if (!name) return setDialogError("Please enter a valid name.");
    const { mode, target } = dialog;
    setBusy(true);
    setDialogError("");
    try {
      if (mode === "rename") {
        await renameProject(target, name);
        if (currentRef.current === target) setCurrent(name);
        setListKey((k) => k + 1);
        toast(`Renamed to “${name}”`);
      } else {
        if (mode === "new") {
          await flush();
          putOnCanvas({ elements: [] });
        }
        try {
          await writeToServer(name, { create: true });
        } catch (e) {
          if (e.status !== 409) throw e;
          if (mode === "new" || !window.confirm(`“${name}” already exists. Overwrite it?`)) {
            throw new Error("A project with that name already exists.");
          }
          await writeToServer(name);
        }
        setCurrent(name);
        setStatus("saved");
        setListKey((k) => k + 1);
        toast(mode === "new" ? `Created “${name}”` : `Saved as “${name}”`);
      }
      setDialog(null);
    } catch (e) {
      setDialogError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm(`Delete “${id}”? This removes it from the save folder.`)) return;
    try {
      await deleteProject(id);
      if (currentRef.current === id) {
        clearTimeout(serverTimer.current);
        setCurrent(null);
      }
      setListKey((k) => k + 1);
      toast(`Deleted “${id}”`);
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 4000);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const scene = await loadFromBlob(file, null, null);
      await flush();
      const existing = (await listProjects()).map((p) => p.id);
      const name = uniqueName(cleanName(file.name.replace(/\.(excalidraw|json|png|svg)$/i, "")) || "Imported", existing);
      putOnCanvas(scene);
      await writeToServer(name, { create: true });
      setCurrent(name);
      setStatus("saved");
      setListKey((k) => k + 1);
      toast(`Imported as “${name}”`);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 4000);
    }
  };

  const exportPng = async () => {
    if (!api) return;
    const elements = api.getSceneElements();
    if (!elements.length) return toast("Nothing to export yet — draw something first!");
    const appState = api.getAppState();
    const blob = await exportToBlob({
      elements,
      files: api.getFiles(),
      appState: { ...appState, exportBackground: true, exportWithDarkMode: appState.theme === "dark" },
      mimeType: "image/png",
      exportPadding: 16,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentRef.current || "vdea"}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Ctrl+S saves to the project folder (instead of Excalidraw's file download)
  useEffect(() => {
    const onKey = (e) => {
      // Ctrl+U underlines the selected words while typing
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "u" && textTarget?.editing) {
        const ta = document.querySelector("textarea.excalidraw-wysiwyg");
        if (ta && ta.selectionStart !== ta.selectionEnd) {
          e.preventDefault();
          e.stopPropagation();
          applyRichStyle(api, textTarget.id, ta.selectionStart, ta.selectionEnd, { kind: "underline", color: "auto" });
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        handleSaveShortcut();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }); // re-bind each render so it sees fresh state

  // warn before closing with unsaved changes
  useEffect(() => {
    const onUnload = (e) => {
      if (serverTimer.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const statusLabel = !current
    ? "Not saved to a project"
    : { saved: "Saved", unsaved: "Editing…", saving: "Saving…", error: "Save failed" }[status];

  const dialogTitles = {
    save: ["Save project", "Save"],
    saveas: ["Save as new project", "Save copy"],
    new: ["New project", "Create"],
    rename: ["Rename project", "Rename"],
  };

  return (
    <div className="app">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
        renderTopRightUI={() => (
          <div className="top-right">
            <button
              className={`project-chip status-${current ? status : "none"}`}
              onClick={() => setShowList(true)}
              title={statusLabel}
            >
              <FolderIcon />
              <span className="project-chip-name">{current || "Untitled"}</span>
              <span className="project-chip-dot" />
            </button>
            <button className="share-btn" onClick={exportPng} title="Download as PNG">
              Export PNG
            </button>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.Item icon={<FolderIcon />} onSelect={() => setShowList(true)}>
            Project list
          </MainMenu.Item>
          <MainMenu.Item icon={<PlusIcon />} onSelect={() => askName("new", "Untitled")}>
            New project
          </MainMenu.Item>
          <MainMenu.Item icon={<SaveIcon />} shortcut="Ctrl+S" onSelect={handleSaveShortcut}>
            Save project
          </MainMenu.Item>
          <MainMenu.Item
            icon={<CopyIcon />}
            onSelect={() => askName("saveas", current ? `${current} copy` : "Untitled")}
          >
            Save as…
          </MainMenu.Item>
          <MainMenu.Item icon={<UploadIcon />} onSelect={() => fileInput.current?.click()}>
            Import file…
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.ItemLink href="https://github.com/excalidraw/excalidraw">
            Excalidraw on GitHub
          </MainMenu.ItemLink>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>

        <WelcomeScreen>
          <WelcomeScreen.Hints.MenuHint />
          <WelcomeScreen.Hints.ToolbarHint />
          <WelcomeScreen.Hints.HelpHint />
          <WelcomeScreen.Center>
            <WelcomeScreen.Center.Logo>
              <span className="brand">Vdea</span>
            </WelcomeScreen.Center.Logo>
            <WelcomeScreen.Center.Heading>
              Projects are saved in the <b>save</b> folder.
            </WelcomeScreen.Center.Heading>
            <WelcomeScreen.Center.Menu>
              <WelcomeScreen.Center.MenuItem icon={<FolderIcon />} onSelect={() => setShowList(true)}>
                Project list
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItem icon={<PlusIcon />} onSelect={() => askName("new", "Untitled")}>
                New project
              </WelcomeScreen.Center.MenuItem>
              <WelcomeScreen.Center.MenuItemHelp />
            </WelcomeScreen.Center.Menu>
          </WelcomeScreen.Center>
        </WelcomeScreen>
      </Excalidraw>

      <TextStylePanel api={api} target={textTarget} theme={theme} onToast={(m) => toast(m, 2500)} />

      <input
        ref={fileInput}
        type="file"
        accept=".excalidraw,.json,.png,.svg"
        style={{ display: "none" }}
        onChange={handleImport}
      />

      <ProjectList
        open={showList}
        theme={theme}
        current={current}
        refreshKey={listKey}
        onClose={() => setShowList(false)}
        onOpen={handleOpenFromList}
        onNew={() => { setShowList(false); askName("new", "Untitled"); }}
        onRename={(id) => askName("rename", id, id)}
        onDelete={handleDelete}
      />

      <NameDialog
        open={!!dialog}
        theme={theme}
        title={dialog ? dialogTitles[dialog.mode][0] : ""}
        confirmLabel={dialog ? dialogTitles[dialog.mode][1] : ""}
        initial={dialog?.initial || ""}
        error={dialogError}
        busy={busy}
        onSubmit={handleDialogSubmit}
        onClose={() => !busy && setDialog(null)}
      />
    </div>
  );
}
