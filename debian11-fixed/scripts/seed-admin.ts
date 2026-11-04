#!/usr/bin/env tsx
/**
 * Seed or update the initial administrator user.
 * Run with: npm run db:seed
 *
 * This is idempotent — running it again updates the password
 * if the user already exists.
 */
import { createClient } from "@libsql/client";
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
    console.error("❌ Missing INITIAL_ADMIN_USERNAME or INITIAL_ADMIN_PASSWORD");
    process.exit(1);
  }

  console.log("🔌 Connecting to Turso...");
  const client = createClient({ url, authToken });

  console.log(`🔐 Hashing password for '${adminUsername}'...`);
  const hash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  // Check if user exists
  const existing = await client.execute({
    sql: "SELECT id FROM users WHERE username = ?",
    args: [adminUsername],
  });

  if (existing.rows.length > 0) {
    // Update password
    await client.execute({
      sql: "UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE username = ?",
      args: [hash, adminUsername],
    });
    console.log(`✅ Updated password for existing user '${adminUsername}'`);
  } else {
    // Insert new admin
    const id = randomUUID();
    await client.execute({
      sql: `INSERT INTO users (id, username, password_hash, is_active, is_admin, created_at, updated_at)
            VALUES (?, ?, ?, 1, 1, unixepoch(), unixepoch())`,
      args: [id, adminUsername, hash],
    });
    console.log(`✅ Created admin user '${adminUsername}' (id: ${id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
