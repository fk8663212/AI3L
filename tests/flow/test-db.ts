import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle/", import.meta.url));

/**
 * An in-memory Postgres (PGlite) with the project's real migrations applied,
 * so flow tests exercise the same SQL, constraints and row locks as Neon.
 */
export async function createTestDb() {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await client.exec(sql.replaceAll("--> statement-breakpoint", ""));
  }
  return drizzle({ client, schema });
}
