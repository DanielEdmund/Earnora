/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PGlite ships WebAssembly that must be loaded from its own package files at
  // runtime (and is never actually executed on Vercel — DATABASE_URL points at
  // real Postgres there). Keep it out of the route-handler bundle.
  serverExternalPackages: ['@electric-sql/pglite'],
  webpack: (config) => {
    // @nestjs/core optionally requires these packages when WebSockets or
    // microservice transports are configured (this app uses neither). They are
    // not installed, so webpack's static resolution must map them to an empty
    // module instead of failing the build.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@nestjs/websockets/socket-module': false,
      '@nestjs/microservices/microservices-module': false,
      '@nestjs/microservices': false,
    };
    return config;
  },
  // NOTE: there is deliberately NO /api rewrite here. app/api/[...path]/route.js
  // is the single entry for /api/*: it runs the API in-process on Vercel and
  // forwards to API_PROXY_ORIGIN (default http://localhost:3000) locally.
};

export default nextConfig;
