/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // the dev badge would sit on the City's key in the bottom-left corner
  devIndicators: false,
  // AVAGUARD: the chain logos' hosts, as builders-hub's next.config.mjs lists them (BSD-3-Clause, Copyright (c) 2021,
  // Ava Labs, Inc.): the badge atlas sends remote logos through the image route
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        // DeFiLlama protocol icons (apps facet / dapp analytics)
        protocol: 'https',
        hostname: 'icons.llamao.fi',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'abs.twimg.com',
      },
      {
        protocol: 'https',
        hostname: '*.public.blob.vercel-storage.com',
      },
      {
        protocol: 'https',
        hostname: 'images.ctfassets.net',
      },
      {
        protocol: 'https',
        hostname: 'f005.backblazeb2.com',
      },
      {
        protocol: 'https',
        hostname: 'explorer-binaryholdings.cogitus.io',
      },
      {
        protocol: 'https',
        hostname: 'cdn.prod.website-files.com',
      },
      {
        protocol: 'https',
        hostname: 'developers.avacloud.io',
      },
      {
        protocol: 'https',
        hostname: 'icons.llama.fi',
      },
    ],
  },
}
export default nextConfig
