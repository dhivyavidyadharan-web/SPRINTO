/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["pg", "@langchain/langgraph-checkpoint-postgres", "nodemailer", "imapflow", "mailparser"],
};
export default nextConfig;
