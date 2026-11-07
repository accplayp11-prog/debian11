#!/usr/bin/env tsx
/**
 * Database setup script:
 * - Loads environment variables from .env.local
 * - Runs all database migrations safely
 * - Verifies required tables
 * - Creates the initial admin user if it does not exist
 * - Ensures admin sandbox and supervisor lock records exist
 *
 * Run with: npm run db:migrate
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";

function userSandboxName(userId: string): string {
  const short = userId.replace(/-/g, "").substring(0, 16);
  return `dwt-${short}`;
}

/**
 * Removes SQL line comments without removing SQL statements.
 * Preserves newlines so statements remain readable.
 */
function removeSqlComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

/**
 * Executes every SQL statement.
 * Fails immediately if any statement fails.
 */
async function runMigration(
  client: ReturnType<typeof createClient>,
  migrationPath: string,
): Promise<void> {
  let rawSql: string;

  try {
    rawSql = readFileSync(migrationPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Cannot read migration file: ${migrationPath}`,
      { cause: error },
    );
  }

  const sql = removeSqlComments(rawSql);

  const statements = sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  console.log(`   Found ${statements.length} SQL statements`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];

    try {
      await client.execute(statement);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error(`\n❌ Migration failed at statement ${i + 1}`);
      console.error(`SQL: ${statement.substring(0, 300)}`);
      throw new Error(`Migration statement ${i + 1} failed: ${message}`, {
        cause: error,
      });
    }
  }
}

/**
 * Checks that all required tables exist.
 */
async function verifyTables(
  client: ReturnType<typeof createClient>,
  requiredTables: string[],
): Promise<void> {
  for (const table of requiredTables) {
    const result = await client.execute({
      sql: `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `,
      args: [table],
    });

    if (result.rows.length === 0) {
      throw new Error(
        `Database verification failed: table '${table}' does not exist.`,
      );
    }
  }

  console.log(`✅ Verified ${requiredTables.length} required tables`);
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const adminUsername = process.env.INITIAL_ADMIN_USERNAME;
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

  if (!url || !authToken) {
    throw new Error(
      "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env.local",
    );
  }

  if (!adminUsername || !adminPassword) {
    throw new Error(
      "Missing INITIAL_ADMIN_USERNAME or INITIAL_ADMIN_PASSWORD in .env.local",
    );
  }

  console.log("🔌 Connecting to Turso database...");

  const client = createClient({
    url,
    authToken,
  });

  try {
    // Migration 001
    console.log("\n📦 Running migration 001 (initial schema)...");

    await runMigration(
      client,
      join(
        process.cwd(),
        "src/database/migrations/001_initial.sql",
      ),
    );

    console.log("✅ Migration 001 complete");

    // Migration 002
    console.log("\n📦 Running migration 002 (multi-user + supervisor)...");

    await runMigration(
      client,
      join(
        process.cwd(),
        "src/database/migrations/002_multiuser_supervisor.sql",
      ),
    );

    console.log("✅ Migration 002 complete");

    // Verify database schema before inserting records.
    console.log("\n🔍 Verifying database tables...");

    await verifyTables(client, [
      "users",
      "sessions",
      "login_attempts",
      "audit_logs",
      "user_sandboxes",
      "managed_processes",
      "supervisor_heartbeats",
      "recovery_events",
      "supervisor_lock",
    ]);

    // Find existing admin user.
    const existing = await client.execute({
      sql: "SELECT id FROM users WHERE username = ?",
      args: [adminUsername],
    });

    let adminId: string;

    if (existing.rows.length > 0) {
      adminId = String(existing.rows[0].id);

      console.log(
        `ℹ️ Admin user '${adminUsername}' already exists (id: ${adminId})`,
      );
    } else {
      console.log(`🔐 Creating admin user '${adminUsername}'...`);

      const passwordHash = await argon2.hash(adminPassword, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
      });

      adminId = randomUUID();

      await client.execute({
        sql: `
          INSERT INTO users (
            id,
            username,
            password_hash,
            is_active,
            is_admin,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 1, 1, unixepoch(), unixepoch())
        `,
        args: [adminId, adminUsername, passwordHash],
      });

      console.log(`✅ Admin user '${adminUsername}' created`);
    }

    // Ensure the existing admin account has admin privileges.
    await client.execute({
      sql: `
        UPDATE users
        SET is_active = 1,
            is_admin = 1,
            updated_at = unixepoch()
        WHERE id = ?
      `,
      args: [adminId],
    });

    // Ensure admin sandbox record exists.
    const sandboxName = userSandboxName(adminId);

    await client.execute({
      sql: `
        INSERT OR IGNORE INTO user_sandboxes (
          id,
          user_id,
          sandbox_name,
          status,
          ttyd_port,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'unknown', 7681, unixepoch(), unixepoch())
      `,
      args: [randomUUID(), adminId, sandboxName],
    });

    console.log("✅ Admin sandbox record verified");

    // Ensure supervisor lock row exists.
    await client.execute({
      sql: `
        INSERT OR IGNORE INTO supervisor_lock (id)
        VALUES ('global')
      `,
      args: [],
    });

    console.log("✅ Supervisor lock record verified");

    console.log("\n🎉 Database setup complete!");
    console.log("\n📋 Summary:");
    console.log(`   Admin user: ${adminUsername}`);
    console.log(`   Admin ID: ${adminId}`);
    console.log(`   Admin sandbox: ${sandboxName}`);
    console.log("   Migrations: 001 + 002");
    console.log("   Required tables: verified");
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error("\n❌ Database setup failed:", message);
  process.exitCode = 1;
});
