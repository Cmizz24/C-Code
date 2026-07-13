import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["cjs", "esm"],
	dts: true,
	noExternal: ["ai-sdk-provider-poe"],
	splitting: false,
	sourcemap: true,
	clean: true,
	outDir: "dist",
})
