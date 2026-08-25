import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: produces a self-contained .next/standalone bundle
  // that we copy into the runtime stage of the Dockerfile. Cuts the
  // production image from ~1.2 GB to ~200 MB and removes the need to
  // ship node_modules.
  output: "standalone",

  /**
   * Descubrimiento OAuth del servidor MCP.
   *
   * Las rutas viven en `src/app/well-known/...` y no en `src/app/.well-known/...`
   * porque Next ignora las carpetas que empiezan por punto: son ficheros
   * ocultos, no rutas. Los rewrites las publican donde los clientes las buscan.
   *
   * Cada documento se sirve en dos formas porque los clientes prueban las dos:
   * la plana, y la que inserta el path del recurso detras del `.well-known`
   * (RFC 9728 §3.1 — `/.well-known/oauth-protected-resource/api/mcp`). Un
   * cliente que solo pruebe la segunda se queda sin descubrir nada si falta.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-authorization-server/:path*",
        destination: "/well-known/oauth-authorization-server",
      },
    ];
  },
};

export default nextConfig;
