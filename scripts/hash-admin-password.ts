import { createAdminPasswordHash } from "../lib/security/crypto";

const password = process.argv.slice(2).join(" ");
if (password.length < 12) {
  console.error("請在 -- 後提供至少 12 字元的管理員密碼。");
  process.exitCode = 1;
} else {
  console.log(createAdminPasswordHash(password));
}
