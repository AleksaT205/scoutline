import { defineConfig } from "tsup";

// Sve zavisnosti se pakuju u jedan fajl → Docker slika sadrži samo dist/.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  noExternal: [/.*/],
  // require/__dirname/__filename ne postoje u ESM-u — neki paketi (npr. libsodium) ih koriste
  banner: {
    js: "import { createRequire as __cr } from 'module'; import { fileURLToPath as __fu } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
});
