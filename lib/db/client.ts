import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@/lib/db/schema";

let cachedDb: ReturnType<typeof createDb> | undefined;

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Connect a Neon Postgres database before using server features.",
    );
  }
  return drizzle({
    connection: databaseUrl,
    schema,
    ws,
  });
}

export function getDb() {
  cachedDb ??= createDb();
  return cachedDb;
}
