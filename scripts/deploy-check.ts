import "./load-env";
import { accessSync, constants, mkdirSync } from "node:fs";
import path from "node:path";

const local = process.env.STORAGE_DRIVER === "local";

const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_ENCRYPTION_KEY",
  "ACCESS_CODE_PEPPER",
  "CRON_SECRET",
  "ADMIN_PASSWORD_HASH",
  "NEXT_PUBLIC_APP_URL",
] as const;

const errors: string[] = [];
const warnings: string[] = [];

if (!local) {
  for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
    if (!process.env[name]?.trim()) errors.push(`缺少 ${name}`);
  }
}
if (!["local", "vercel"].includes(process.env.STORAGE_DRIVER ?? "vercel")) errors.push("STORAGE_DRIVER 必須為 local 或 vercel");
if (local) {
  const root = path.resolve(process.env.LOCAL_STORAGE_PATH ?? ".local/storage");
  const publicRoot = path.resolve("public");
  if (root === publicRoot || root.startsWith(publicRoot + path.sep)) errors.push("本機研究資料不得放在 public/ 下");
  else {
    try { mkdirSync(root, { recursive: true, mode: 0o700 }); accessSync(root, constants.R_OK | constants.W_OK); }
    catch { errors.push("LOCAL_STORAGE_PATH 無法讀寫"); }
  }
}

for (const name of required) {
  if (!process.env[name]?.trim()) errors.push(`缺少 ${name}`);
}

for (const name of [
  "AUTH_SECRET",
  "APP_ENCRYPTION_KEY",
  "ACCESS_CODE_PEPPER",
  "CRON_SECRET",
] as const) {
  const value = process.env[name];
  if (value && value.length < 32) {
    errors.push(`${name} 至少需要 32 個字元`);
  }
}

if (
  process.env.DATABASE_URL &&
  !/^postgres(?:ql)?:\/\//u.test(process.env.DATABASE_URL)
) {
  errors.push("DATABASE_URL 不是 PostgreSQL 連線字串");
}

if (
  process.env.ADMIN_PASSWORD_HASH &&
  !process.env.ADMIN_PASSWORD_HASH.startsWith("scrypt$")
) {
  errors.push("ADMIN_PASSWORD_HASH 必須由 npm run auth:hash 產生");
}

if (process.env.NEXT_PUBLIC_APP_URL) {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL);
    if (
      process.env.VERCEL_ENV === "production" &&
      url.protocol !== "https:"
    ) {
      errors.push("Production 的 NEXT_PUBLIC_APP_URL 必須使用 HTTPS");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      errors.push("NEXT_PUBLIC_APP_URL 只能包含網站 origin，不可含路徑或查詢參數");
    }
  } catch {
    errors.push("NEXT_PUBLIC_APP_URL 不是有效網址");
  }
}

if (
  process.env.GOOGLE_CLIENT_ID &&
  !process.env.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com")
) {
  warnings.push("GOOGLE_CLIENT_ID 看起來不像 Google OAuth Web Client ID");
}

if (
  !local &&
  !process.env.BLOB_READ_WRITE_TOKEN &&
  !process.env.VERCEL &&
  !process.env.VERCEL_OIDC_TOKEN
) {
  warnings.push(
    "本機未偵測到 Blob token；Vercel Production 可改用已連接 Private Blob 的 OIDC",
  );
}

if (!local && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
  errors.push(
    "使用 Vercel Blob OIDC 時必須同時提供 BLOB_STORE_ID，才能簽發學生上傳網址",
  );
}

if (warnings.length) {
  console.log("部署提醒：");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.error("部署前檢查失敗：");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("部署前檢查通過：必要環境變數格式正確。");
}
