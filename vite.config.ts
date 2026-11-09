import adapter from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    sveltekit({ adapter: adapter({ runtime: "nodejs24.x", maxDuration: 60 }) }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        inline: [
          "delightful-ui",
          "@standard-reader/renderer-svelte",
          "tdesign-icons-svg",
        ],
      },
    },
  },
});
