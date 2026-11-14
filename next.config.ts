import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off on purpose (DECISIONS.md): SPEC §7 reads the `lang` cookie on the server to render
  // <html lang> and text with no flash; Cache Components would push that behind Suspense or /[lang] URLs.
  cacheComponents: false,
  // CLAUDE.md is this repo's single agent-rules file; stop `next dev` from writing AGENTS.md.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
