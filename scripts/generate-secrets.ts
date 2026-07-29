import { randomBytes } from "node:crypto";

const names = [
  "AUTH_SECRET",
  "APP_ENCRYPTION_KEY",
  "ACCESS_CODE_PEPPER",
  "CRON_SECRET",
] as const;

for (const name of names) {
  console.log(`${name}=${randomBytes(32).toString("base64url")}`);
}
