import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import projectsApi from "./server/projectsApi.js";

export default defineConfig({
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
