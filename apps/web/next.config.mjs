/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base URL is read server-side only (see src/lib/api.ts), so the
  // NestJS origin is never baked into the client bundle.
};

export default nextConfig;
