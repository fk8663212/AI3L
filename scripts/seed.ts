import "dotenv/config";
import { bootstrapDefaults } from "../lib/services/admin-service";

async function main() {
  await bootstrapDefaults();
  console.log("已建立預設模型與大稻埕研究任務草稿。");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
