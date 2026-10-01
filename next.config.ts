import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // React Strict Mode disabled untuk hindari Supabase auth lock orphan
  // di dev. Production build tidak kena karena Strict Mode tidak aktif
  // di prod build. Bisa di-enable lagi nanti kalau Supabase JS client
  // udah handle ini dengan benar (atau pakai custom lock implementation).
  reactStrictMode: false,
};

export default nextConfig;
