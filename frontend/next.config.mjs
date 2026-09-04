/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  // Next.js 14's dev server does NOT host-allow-list (unlike Vite), so the VM
  // preview URL reaches it without extra config. (`allowedDevOrigins` is a
  // Next 15+ key and is intentionally omitted here.)
  //
  // The frontend reads persisted JSON from data/** at request time via
  // server-only loaders. It tries `frontend/data/**` (cwd) first — the only
  // layout that exists in production, since Railway's build root is
  // `/frontend` and no parent directory is deployed — then falls back to
  // `../data/**` for local monorepo checkouts. No secrets are ever exposed
  // to the browser. See lib/data-loader.ts.
  experimental: {
    // Allow importing type-only modules from the parent project (../lib, ../modules).
    externalDir: true,
  },
};

export default nextConfig;
