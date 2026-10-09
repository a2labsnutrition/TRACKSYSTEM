import type { NextConfig } from "next";

/**
 * Cache Components desativado de propósito: o painel é 100% dinâmico por
 * usuário/workspace (cookies + dados ao vivo), então cada requisição é
 * renderizada no servidor.
 */
const nextConfig: NextConfig = {
  cacheComponents: false,
  serverExternalPackages: ["playwright-core"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/t.js",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
