/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next.js 14's dev server does NOT host-allow-list (unlike Vite), so the VM
  // preview URL reaches it without extra config. (`allowedDevOrigins` is a
  // Next 15+ key and is intentionally omitted here.)
  //
  // The frontend reads persisted JSON from the sibling data/** dir at request
  // time via server-only loaders. No secrets are ever exposed to the browser.
  experimental: {
    // Allow importing type-only modules from the parent project (../lib, ../modules).
    externalDir: true,
  },
};

export default nextConfig;
