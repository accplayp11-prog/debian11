#!/usr/bin/env tsx
/**
 * Database setup script: runs migrations and seeds the initial admin user.
 * Run with: npm run db:migrate
 *
 * Reads from environment variables:
 *   TURSO_DATABASE_URL, TURSO_AUTH_TOKEN,
 *   INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_PASSWORD
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { join } from "path";
import * as argon2 from "argon2";
import { randomUUID } from "crypto";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const adminUsername = process.env.INITIAL_ADMIN_USERNAME;
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

  if (!url || !authToken) {
    console.error("❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN");
    process.exit(1);
  }

  if (!adminUsername || !adminPassword) {
    console.error(
      "❌ Missing INITIAL_ADMIN_USERNAME or INITIAL_ADMIN_PASSWORD"
    );
    console.error(
      "   These are required to create the initial administrator account."
    );
    process.exit(1);
  }

  console.log("🔌 Connecting to Turso database...");
  const client = createClient({ url, authToken });

  // Run migrations
  console.log("📦 Running database migrations...");
  const migrationPath = join(
    process.cwd(),
    "src/database/migrations/001_initial.sql"
  );
  const migrationSQL = readFileSync(migrationPath, "utf-8");

  // Split on semicolons and run each statement
  const statements = migrationSQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const stmt of statements) {
    try {
      await client.execute(stmt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Ignore "already exists" errors (idempotent migrations)
      if (!msg.includes("already exists")) {
        throw err;
      }
    }
  }
  console.log("✅ Migrations complete");

  // Check if admin user already exists
  const existing = await client.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: [adminUsername],
  });

  if (existing.rows.length > 0) {
    console.log(
      `ℹ️  Admin user '${adminUsername}' already exists. Skipping seed.`
    );
  } else {
    // Hash password with Argon2id
    console.log(`🔐 Creating admin user '${adminUsername}'...`);
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const userId = randomUUID();
    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, is_active, is_admin, created_at, updated_at)
            VALUES (?, ?, ?, 1, 1, unixepoch(), unixepoch())`,
      args: [userId, adminUsername, passwordHash],
    });
    console.log(`✅ Admin user '${adminUsername}' created (id: ${userId})`);
  }

  // Insert initial sandbox metadata row (upsert)
  await client.execute({
    sql: `INSERT OR REPLACE INTO sandbox_metadata (id, sandbox_name, status, updated_at)
          VALUES ('shared', ?, 'unknown', unixepoch())`,
    args: [process.env.SANDBOX_NAME || "debian-shared-terminal"],
  });

  console.log("✅ Database setup complete");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Database setup failed:", err);
  process.exit(1);
});
