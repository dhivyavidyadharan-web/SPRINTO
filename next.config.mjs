/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres", "googleapis"],
};
export default nextConfig;
