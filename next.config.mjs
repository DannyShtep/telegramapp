/** @type {import('next').NextConfig} */
const nextConfig = {
eslint: {
  ignoreDuringBuilds: true,
},
typescript: {
  ignoreBuildErrors: true,
},
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'api.dicebear.com',
      port: '',
      pathname: '/7.x/avataaars/svg/**',
    },
  ],
  unoptimized: true,
},
};

export default nextConfig;
