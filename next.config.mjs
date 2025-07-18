/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "t.me",
        port: "",
        pathname: "/i/userpic/**",
      },
    ],
  },
}

export default nextConfig
