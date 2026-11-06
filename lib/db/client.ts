import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

const globalDb = globalThis as typeof globalThis & { ai3lDb?: ReturnType<typeof createDb> };

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Set the local PostgreSQL connection in .env.local.",
    );
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return drizzle({ client: pool, schema });
}

export function getDb() {
  globalDb.ai3lDb ??= createDb();
  return globalDb.ai3lDb;
}
