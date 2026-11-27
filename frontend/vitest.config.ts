import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    // Mismo origen que la API por defecto: evita preflights CORS no mockeados en los tests con MSW.
    environmentOptions: { jsdom: { url: "http://localhost:8080/" } },
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    testTimeout: 30_000,
    fileParallelism: !process.env.CI,
  },
});
