/**
 * Turso (libSQL) database client
 * All database access goes through this module.
 */
import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;

export function getTursoClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables. " +
        "Copy .env.example to .env.local and configure Turso credentials."
    );
  }

  client = createClient({ url, authToken });
  return client;
}

export type { Client };
