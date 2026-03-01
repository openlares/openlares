import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@openlares/core',
    '@openlares/api-client',
    '@openlares/ui',
    '@openlares/game-engine',
  ],
};

export default nextConfig;
