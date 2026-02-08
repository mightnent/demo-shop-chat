import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function seed() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Ensure chat-host/.env exists and includes DATABASE_URL."
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);
  void db;
  console.log(
    "Seed completed: no users are inserted. Users are created on first Cognito login."
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
