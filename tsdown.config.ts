import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: {
      index: "index.ts",
      plugin: "plugin.ts",
      cli: "cli.ts",
      "cli-runtime": "cli-runtime.ts",
    },
    outDir: "dist",
    dts: true,
    splitting: false,
    clean: true,
  },
  {
    entry: {
      "core/agent-registry": "core/agent-registry.ts",
      "core/message-bus": "core/message-bus.ts",
      "core/message-types": "core/message-types.ts",
      "core/hook-types": "core/hook-types.ts",
    },
    outDir: "dist",
    dts: true,
    splitting: false,
    clean: false,
  },
]);
