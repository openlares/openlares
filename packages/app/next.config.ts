import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@openlares/core',
    '@openlares/api-client',
    '@openlares/ui',
    '@openlares/game-engine',
  ],
  // We lint via turbo, not Next.js built-in
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
