import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const base = process.env.CLEANUP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET is required for cleanup.");
async function cleanup() {
  const response = await fetch(new URL("/api/cron/cleanup-blob", base), {
    headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Cleanup failed: HTTP ${response.status}`);
  console.log(JSON.stringify({ at: new Date().toISOString(), ...await response.json() }));
}
if (process.argv.includes("--once")) await cleanup();
else {
  const run = () => cleanup().catch((error) => console.error(error.message));
  await run();
  setInterval(run, 24 * 60 * 60 * 1000);
}
