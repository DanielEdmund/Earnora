/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Production fallback (B7): the web app calls same-origin /api/*, which is
    // forwarded here to the API server. Runs on the Next server, so a plain
    // http://host:port is fine even behind HTTPS. Override when the API lives
    // on another machine: API_PROXY_ORIGIN=https://api.example.com
    const api = process.env.API_PROXY_ORIGIN || 'http://localhost:3000';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};

export default nextConfig;
