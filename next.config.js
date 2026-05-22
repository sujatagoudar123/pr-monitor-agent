/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['rss-parser', 'cheerio', 'nodemailer'],
};

module.exports = nextConfig;
