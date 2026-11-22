import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // CommonJS only: tsup's ESM output rewrites require() into a __require()
  // shim that Metro can't see, so the optional push modules would never be
  // bundled. One CJS build keeps literal require() calls inside try blocks.
  format: ["cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  // "node" only so esbuild adds the export annotation Node needs for named
  // ESM imports of the CJS file; the code itself uses no Node APIs.
  platform: "node",
  sourcemap: true,
  external: ["react-native", "expo-notifications", "@react-native-firebase/messaging", "@react-native-async-storage/async-storage"],
});
