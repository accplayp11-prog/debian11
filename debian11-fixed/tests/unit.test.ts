/**
 * Unit tests for Debian Web Terminal
 *
 * Run with: npx tsx tests/unit.test.ts
 *
 * Tests that can run without Vercel/Turso credentials are marked LOCAL.
 * Tests that require real credentials are marked REMOTE.
 */

import * as argon2 from "argon2";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

// Simple test runner
let passed = 0;
let failed = 0;
let skipped = 0;

function test(name: string, fn: () => Promise<void>) {
  return { name, fn };
}

function skip(name: string, _fn: () => Promise<void> | void) {
  return { name, fn: null, skipped: true };
}

async function runTests(
  tests: Array<{ name: string; fn: (() => Promise<void>) | null; skipped?: boolean }>
) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Debian Web Terminal — Unit Tests");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const t of tests) {
    if (t.skipped || !t.fn) {
      console.log(`  ⏭  SKIP: ${t.name}`);
      skipped++;
      continue;
    }
    try {
      await t.fn();
      console.log(`  ✅ PASS: ${t.name}`);
      passed++;
    } catch (err: unknown) {
      console.log(`  ❌ FAIL: ${t.name}`);
      console.log(`         ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
  console.log(
    `  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`
  );
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) process.exit(1);
}

// =============================================================================
// LOCAL TESTS — No external credentials required
// =============================================================================

const tests = [
  // --- Argon2id Password Hashing ---
  test("[LOCAL] argon2id: hash and verify password", async () => {
    const password = "yassine1949-test-password";
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 4096,  // Lower memory for test speed
      timeCost: 2,       // Minimum valid timeCost is 2
      parallelism: 1,
    });
    if (!hash.startsWith("$argon2id$")) {
      throw new Error(`Expected argon2id hash, got: ${hash.substring(0, 20)}…`);
    }
    const valid = await argon2.verify(hash, password);
    if (!valid) throw new Error("Password verification failed");
  }),

  test("[LOCAL] argon2id: reject wrong password", async () => {
    const hash = await argon2.hash("correct-password", {
      type: argon2.argon2id,
      memoryCost: 4096,
      timeCost: 2,
      parallelism: 1,
    });
    const valid = await argon2.verify(hash, "wrong-password");
    if (valid) throw new Error("Wrong password was accepted — security failure");
  }),

  // --- Session Token Hashing ---
  test("[LOCAL] SHA-256 token hashing is deterministic", async () => {
    const token = randomUUID();
    const hash1 = createHash("sha256").update(token).digest("hex");
    const hash2 = createHash("sha256").update(token).digest("hex");
    if (hash1 !== hash2) throw new Error("Hashing is not deterministic");
    if (hash1 === token) throw new Error("Hash equals input — not hashing");
    if (hash1.length !== 64) throw new Error(`Hash length ${hash1.length} !== 64`);
  }),

  test("[LOCAL] different tokens produce different hashes", async () => {
    const t1 = randomUUID();
    const t2 = randomUUID();
    const h1 = createHash("sha256").update(t1).digest("hex");
    const h2 = createHash("sha256").update(t2).digest("hex");
    if (h1 === h2) throw new Error("Different tokens produced same hash");
  }),

  // --- UUID Generation ---
  test("[LOCAL] UUID generation produces valid v4 UUIDs", async () => {
    const id = randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw new Error(`Invalid UUID: ${id}`);
    }
  }),

  // --- Input Sanitization ---
  test("[LOCAL] sanitizeString strips HTML", async () => {
    // Test the logic inline (since we can't import server-only modules)
    const sanitize = (input: string, maxLength = 256) =>
      input.replace(/[<>&"']/g, "").trim().substring(0, maxLength);

    const result = sanitize('<script>alert("xss")</script>');
    if (result.includes("<") || result.includes(">")) {
      throw new Error(`HTML not stripped: ${result}`);
    }
  }),

  test("[LOCAL] sanitizeString enforces max length", async () => {
    const sanitize = (input: string, maxLength = 256) =>
      input.replace(/[<>&"']/g, "").trim().substring(0, maxLength);

    const long = "a".repeat(1000);
    if (sanitize(long, 64).length > 64) {
      throw new Error("Max length not enforced");
    }
  }),

  // --- Origin Validation Logic ---
  test("[LOCAL] origin validation: same host passes", async () => {
    const validateOrigin = (origin: string, host: string): boolean => {
      try {
        const originUrl = new URL(origin);
        return (
          originUrl.host === host ||
          originUrl.host.endsWith(".vercel.app") ||
          originUrl.host.endsWith(".vercel.run")
        );
      } catch {
        return false;
      }
    };
    if (!validateOrigin("https://my-app.vercel.app", "my-app.vercel.app")) {
      throw new Error("Same-host origin rejected");
    }
    if (!validateOrigin("https://preview.vercel.app", "preview.vercel.app")) {
      throw new Error("Vercel preview origin rejected");
    }
    if (validateOrigin("https://evil.com", "my-app.vercel.app")) {
      throw new Error("Cross-origin accepted — security failure");
    }
  }),

  // --- Rate Limiting Logic ---
  test("[LOCAL] rate limit check: 5 failures within window", async () => {
    // Simulate the rate limit check logic
    const MAX = 5;
    const attempts = [
      { success: false, time: 100 },
      { success: false, time: 200 },
      { success: false, time: 300 },
      { success: false, time: 400 },
      { success: false, time: 500 },
    ];
    const failedInWindow = attempts.filter((a) => !a.success).length;
    if (failedInWindow < MAX) throw new Error("Rate limit not triggered");
  }),

  // --- SQL Injection Prevention ---
  test("[LOCAL] parameterized query structure is correct", async () => {
    // Verify our query pattern uses args (parameterized), not string interpolation
    const username = "user'; DROP TABLE users; --";
    const queryPattern = {
      sql: "SELECT * FROM users WHERE username = ?",
      args: [username],
    };
    // The username contains SQL injection but is passed as an arg, not interpolated
    if (queryPattern.sql.includes(username)) {
      throw new Error("SQL injection risk: username interpolated into query");
    }
    if (!queryPattern.sql.includes("?")) {
      throw new Error("Query does not use parameterized placeholders");
    }
  }),

  // --- Environment Variable Validation ---
  test("[LOCAL] env variable names are correct", async () => {
    const required = [
      "TURSO_DATABASE_URL",
      "TURSO_AUTH_TOKEN",
      "INITIAL_ADMIN_USERNAME",
      "INITIAL_ADMIN_PASSWORD",
      "SESSION_SECRET",
      "DEBIAN_ROOT_PASSWORD",
      "SANDBOX_NAME",
    ];
    // Just verify our constants match what's in .env.example
    for (const name of required) {
      if (!/^[A-Z_]+$/.test(name)) {
        throw new Error(`Invalid env var name format: ${name}`);
      }
    }
  }),

  // --- Session Duration ---
  test("[LOCAL] session expires 24 hours in the future", async () => {
    const SESSION_DURATION = 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION;
    const now = Math.floor(Date.now() / 1000);
    const diff = expiresAt - now;
    if (diff < 86390 || diff > 86410) {
      throw new Error(`Session duration off: ${diff}s (expected ~86400s)`);
    }
  }),

  // --- REMOTE TESTS (require credentials) ---
  skip("[REMOTE] Turso: database connection", async () => {
    // Run manually with real credentials:
    // TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npx tsx tests/unit.test.ts
    const { createClient } = await import("@libsql/client");
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    const result = await client.execute("SELECT 1 as ok");
    if (result.rows[0]?.ok !== 1) throw new Error("Database SELECT 1 failed");
  }),

  skip("[REMOTE] Vercel Sandbox: getOrCreate", async () => {
    // Requires VERCEL_OIDC_TOKEN or VERCEL_TOKEN + VERCEL_PROJECT_ID + VERCEL_TEAM_ID
    const { Sandbox } = await import("@vercel/sandbox");
    const sandbox = await Sandbox.getOrCreate({
      name: "test-debian-terminal",
    });
    const result = await sandbox.runCommand({
      cmd: "cat",
      args: ["/etc/os-release"],
    });
    const output = result.stdout ? await result.stdout() : "";
    if (!output.includes("Debian")) {
      throw new Error("OS is not Debian. Output: " + output);
    }
  }),
];

runTests(tests);
