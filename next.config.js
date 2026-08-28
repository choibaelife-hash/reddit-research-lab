/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  // 도커 이미지를 작게 만든다. Railway 배포에 필요하다(06-DEPLOY).
  output: "standalone",
};

export default nextConfig;
