import { defineConfig } from "tsup";

// Sve zavisnosti se pakuju u jedan fajl → Docker slika sadrži samo dist/.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  noExternal: [/.*/],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
