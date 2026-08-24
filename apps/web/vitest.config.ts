import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Fix minor-followups 2026-08-24 — alignement avec tsconfig.json ("@/*" ->
  // "./src/*") : jusqu'ici aucun test n'importait (même transitivement) un
  // module utilisant l'alias "@/...", donc l'absence de résolution passait
  // inaperçue (route-protection.spec.ts n'utilise que des imports relatifs).
  // actions.spec.ts est le premier à importer un module (actions.ts) qui
  // dépend de "@/lib/session" et "@/lib/trust-api".
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
  },
});
