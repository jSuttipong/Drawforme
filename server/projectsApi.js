// Tiny file API used by the Vite dev/preview server.
// Stores every project as save/<name>.excalidraw (+ save/<name>.thumb.svg preview).
import fs from "node:fs/promises";
import path from "node:path";

const EXT = ".excalidraw";
const THUMB = ".thumb.svg";
const ID_RE = /^[\p{L}\p{N}\p{M} _.()\-]{1,80}$/u;
const MAX_BODY = 100 * 1024 * 1024; // 100 MB (embedded images can be big)

const send = (res, status, data) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("File too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const exists = (p) => fs.access(p).then(() => true, () => false);
const validId = (id) => ID_RE.test(id) && !id.startsWith(".") && !id.includes("..");

export default function projectsApi() {
  const saveDir = path.resolve(process.cwd(), "save");
  const file = (id) => path.join(saveDir, id + EXT);
  const thumb = (id) => path.join(saveDir, id + THUMB);

  const handler = async (req, res, next) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/api/projects")) return next();

    try {
      await fs.mkdir(saveDir, { recursive: true });
      const [id, sub] = url.pathname
        .replace(/^\/api\/projects\/?/, "")
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);

      // GET /api/projects -> list
      if (!id) {
        if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
        const names = (await fs.readdir(saveDir)).filter((f) => f.endsWith(EXT));
        const items = await Promise.all(
          names.map(async (f) => {
            const pid = f.slice(0, -EXT.length);
            const st = await fs.stat(path.join(saveDir, f));
            return {
              id: pid,
              name: pid,
              size: st.size,
              updatedAt: st.mtimeMs,
              hasThumb: await exists(thumb(pid)),
            };
          })
        );
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        return send(res, 200, items);
      }

      if (!validId(id)) return send(res, 400, { error: "Invalid project name" });

      // GET /api/projects/:id/thumb
      if (sub === "thumb") {
        if (!(await exists(thumb(id)))) return send(res, 404, { error: "No preview" });
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/svg+xml");
        res.setHeader("Cache-Control", "no-cache");
        return res.end(await fs.readFile(thumb(id)));
      }

      // POST /api/projects/:id/rename  { newId }
      if (sub === "rename" && req.method === "POST") {
        const { newId } = JSON.parse(await readBody(req));
        if (!validId(newId)) return send(res, 400, { error: "Invalid project name" });
        if (!(await exists(file(id)))) return send(res, 404, { error: "Project not found" });
        if (newId !== id && (await exists(file(newId))))
          return send(res, 409, { error: "A project with that name already exists" });
        await fs.rename(file(id), file(newId));
        if (await exists(thumb(id))) await fs.rename(thumb(id), thumb(newId));
        return send(res, 200, { ok: true, id: newId });
      }

      if (sub) return send(res, 404, { error: "Not found" });

      switch (req.method) {
        case "GET": {
          if (!(await exists(file(id)))) return send(res, 404, { error: "Project not found" });
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          return res.end(await fs.readFile(file(id)));
        }
        case "PUT": {
          // body: { scene: string (excalidraw JSON), thumbnail?: string (svg) }
          const { scene, thumbnail } = JSON.parse(await readBody(req));
          JSON.parse(scene); // validate
          if (url.searchParams.get("create") === "1" && (await exists(file(id))))
            return send(res, 409, { error: "A project with that name already exists" });
          await fs.writeFile(file(id), scene, "utf8");
          if (thumbnail) await fs.writeFile(thumb(id), thumbnail, "utf8");
          else if (await exists(thumb(id))) await fs.unlink(thumb(id));
          return send(res, 200, { ok: true, id, updatedAt: Date.now() });
        }
        case "DELETE": {
          if (await exists(file(id))) await fs.unlink(file(id));
          if (await exists(thumb(id))) await fs.unlink(thumb(id));
          return send(res, 200, { ok: true });
        }
        default:
          return send(res, 405, { error: "Method not allowed" });
      }
    } catch (e) {
      console.error("[projects-api]", e);
      return send(res, 500, { error: e.message || "Server error" });
    }
  };

  return {
    name: "vdea-projects-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
