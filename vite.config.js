import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import projectsApi from "./server/projectsApi.js";

export default defineConfig({
  // GitHub Pages serves the site from https://<user>.github.io/Drawforme/
  base: process.env.GITHUB_PAGES ? "/Drawforme/" : "/",
  plugins: [react(), projectsApi()],
  // recommended by Excalidraw docs for Vite
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: {
    open: true,
    // saving drawings must not trigger page reloads
    watch: { ignored: ["**/save/**"] },
  },
});
