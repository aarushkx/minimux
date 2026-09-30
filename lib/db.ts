import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { getCommonEnv } from "./env";
import * as schema from "./schema";

let dbInstance: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  if (!dbInstance) {
    const sql = neon(getCommonEnv().databaseUrl);
    dbInstance = drizzle(sql, { schema });
  }
  return dbInstance;
}
