import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

let cachedDb: ReturnType<typeof createDb> | undefined;

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Connect a Neon Postgres database before using server features.",
    );
  }
  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}

export function getDb() {
  cachedDb ??= createDb();
  return cachedDb;
}
