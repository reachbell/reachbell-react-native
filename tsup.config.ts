import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "es2020",
  platform: "neutral",
  sourcemap: true,
  external: ["react-native", "expo-notifications", "@react-native-firebase/messaging", "@react-native-async-storage/async-storage"],
});
