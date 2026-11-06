import { randomBytes, scryptSync } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";

await mkdir(".local/storage", { recursive: true, mode: 0o700 });
for (const name of [".env.local", ".env"]) {
  try {
    await access(name);
    throw new Error(`${name} 已存在；不會覆寫既有密鑰。請依 README 手動補齊本機設定。`);
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const secret = () => randomBytes(32).toString("hex");
const password = process.env.LOCAL_ADMIN_PASSWORD || randomBytes(18).toString("base64url");
if (password.length < 12) throw new Error("LOCAL_ADMIN_PASSWORD 至少需要 12 個字元。");
const salt = randomBytes(16);
const hash = `scrypt$${salt.toString("base64url")}$${scryptSync(password, salt, 64).toString("base64url")}`;
const dbPassword = secret();
const port = process.env.POSTGRES_PORT || "5432";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error("POSTGRES_PORT 無效。");
const composeEnv = [
  "POSTGRES_USER=ai3l", `POSTGRES_PASSWORD=${dbPassword}`, "POSTGRES_DB=ai3l", `POSTGRES_PORT=${port}`,
  `LOCAL_UID=${process.getuid?.() ?? 1000}`, `LOCAL_GID=${process.getgid?.() ?? 1000}`, "APP_PORT=3000",
].join("\n") + "\n";
const appEnv = [
  `DATABASE_URL=postgresql://ai3l:${dbPassword}@127.0.0.1:${port}/ai3l`,
  "STORAGE_DRIVER=local", "LOCAL_STORAGE_PATH=.local/storage", "NEXT_PUBLIC_APP_URL=http://localhost:3000",
  `AUTH_SECRET=${secret()}`, `APP_ENCRYPTION_KEY=${secret()}`, `ACCESS_CODE_PEPPER=${secret()}`, `CRON_SECRET=${secret()}`,
  `ADMIN_PASSWORD_HASH=${hash.replaceAll("$", "\\$")}`,
].join("\n") + "\n";
await writeFile(".env", composeEnv, { mode: 0o600, flag: "wx" });
await writeFile(".env.local", appEnv, { mode: 0o600, flag: "wx" });
await writeFile(".local/admin-password.txt", password + "\n", { mode: 0o600, flag: "wx" });
console.log("已建立 .env、.env.local 與本機儲存目錄。管理員密碼保存在 .local/admin-password.txt。");
console.log("完整 Docker 部署：docker compose up --build -d");
console.log("本機開發：docker compose up -d postgres，接著 npm run db:migrate、npm run db:seed、npm run dev。");
