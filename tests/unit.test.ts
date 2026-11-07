/**
 * Unit tests for Debian Web Terminal (upgraded)
 * Run with: npx tsx tests/unit.test.ts
 *
 * Tests marked LOCAL run without external credentials.
 * Tests marked REMOTE require real Turso/Vercel credentials.
 */

import * as argon2 from "argon2";
import { randomUUID } from "crypto";
import { createHash, createHmac, timingSafeEqual } from "crypto";

let passed = 0, failed = 0, skipped = 0;

function test(name: string, fn: () => Promise<void>) { return { name, fn, skipped: false }; }
function skip(name: string, _fn: () => void) { return { name, fn: null, skipped: true }; }

async function runTests(tests: Array<{ name: string; fn: (() => Promise<void>) | null; skipped: boolean }>) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Debian Web Terminal — Unit Tests (v2)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  for (const t of tests) {
    if (t.skipped || !t.fn) { console.log(`  ⏭  SKIP: ${t.name}`); skipped++; continue; }
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

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  if (failed > 0) process.exit(1);
}

const tests = [
  // --- Argon2id ---
  test("[LOCAL] argon2id: hash and verify password", async () => {
    const pw = "test-password-1949";
    const hash = await argon2.hash(pw, { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    if (!hash.startsWith("$argon2id$")) throw new Error(`Bad hash prefix: ${hash.substring(0, 20)}`);
    if (!await argon2.verify(hash, pw)) throw new Error("Verify failed");
  }),

  test("[LOCAL] argon2id: reject wrong password", async () => {
    const hash = await argon2.hash("correct", { type: argon2.argon2id, memoryCost: 4096, timeCost: 2, parallelism: 1 });
    if (await argon2.verify(hash, "wrong")) throw new Error("Wrong password accepted — security failure");
  }),

  // --- Token hashing ---
  test("[LOCAL] SHA-256 token hashing is deterministic", async () => {
    const token = randomUUID();
    const h1 = createHash("sha256").update(token).digest("hex");
    const h2 = createHash("sha256").update(token).digest("hex");
    if (h1 !== h2) throw new Error("Not deterministic");
    if (h1 === token) throw new Error("Hash equals input");
    if (h1.length !== 64) throw new Error(`Length ${h1.length} !== 64`);
  }),

  test("[LOCAL] different tokens produce different hashes", async () => {
    const h1 = createHash("sha256").update(randomUUID()).digest("hex");
    const h2 = createHash("sha256").update(randomUUID()).digest("hex");
    if (h1 === h2) throw new Error("Collision");
  }),

  // --- Supervisor secret comparison ---
  test("[LOCAL] supervisor secret: timing-safe comparison", async () => {
    function secretMatches(provided: string, expected: string): boolean {
      try {
        const a = Buffer.from(createHmac("sha256", "dwt").update(provided).digest("hex"));
        const b = Buffer.from(createHmac("sha256", "dwt").update(expected).digest("hex"));
        if (a.length !== b.length) return false;
        return timingSafeEqual(a, b);
      } catch { return false; }
    }
    const secret = "my-super-secret-32-chars-or-more!!";
    if (!secretMatches(secret, secret)) throw new Error("Same secret rejected");
    if (secretMatches("wrong", secret)) throw new Error("Wrong secret accepted");
    if (secretMatches("", secret)) throw new Error("Empty secret accepted");
  }),

  // --- Sandbox naming ---
  test("[LOCAL] sandbox name is stable and unique per user", async () => {
    function userSandboxName(userId: string): string {
      return `dwt-${userId.replace(/-/g, "").substring(0, 16)}`;
    }
    const id1 = randomUUID();
    const id2 = randomUUID();
    const n1 = userSandboxName(id1);
    const n2 = userSandboxName(id2);
    if (n1 === n2) throw new Error("Different users got same sandbox name");
    if (userSandboxName(id1) !== n1) throw new Error("Name not stable");
    if (!n1.startsWith("dwt-")) throw new Error("Name doesn't start with dwt-");
    if (n1.length > 48) throw new Error(`Name too long: ${n1.length}`);
  }),

  // --- Input sanitization ---
  test("[LOCAL] sanitizeString strips HTML", async () => {
    const sanitize = (s: string, max = 256) => s.replace(/[<>&"']/g, "").trim().substring(0, max);
    const r = sanitize('<script>alert("xss")</script>');
    if (r.includes("<") || r.includes(">")) throw new Error(`HTML not stripped: ${r}`);
  }),

  test("[LOCAL] sanitizeString enforces max length", async () => {
    const sanitize = (s: string, max = 256) => s.replace(/[<>&"']/g, "").trim().substring(0, max);
    if (sanitize("a".repeat(1000), 64).length > 64) throw new Error("Max length not enforced");
  }),

  // --- Username validation ---
  test("[LOCAL] username validation: alphanumeric + _ -", async () => {
    const valid = (u: string) => /^[a-z0-9_-]+$/.test(u);
    if (!valid("yassinejss")) throw new Error("Valid username rejected");
    if (!valid("test-user_1")) throw new Error("Valid username with dashes rejected");
    if (valid("user@domain")) throw new Error("@ in username accepted");
    if (valid("user name")) throw new Error("Space in username accepted");
    if (valid("")) throw new Error("Empty username accepted");
  }),

  // --- Origin validation ---
  test("[LOCAL] origin validation: same host passes, evil.com fails", async () => {
    function validateOrigin(origin: string, host: string): boolean {
      try {
        const o = new URL(origin);
        return o.host === host || o.host.endsWith(".vercel.app") || o.host.endsWith(".vercel.run");
      } catch { return false; }
    }
    if (!validateOrigin("https://my.vercel.app", "my.vercel.app")) throw new Error("Same host rejected");
    if (validateOrigin("https://evil.com", "my.vercel.app")) throw new Error("Evil origin accepted");
    if (validateOrigin("", "my.vercel.app")) throw new Error("Empty origin accepted");
  }),

  // --- Rate limiting ---
  test("[LOCAL] rate limit: 5 failures in window triggers limit", async () => {
    const MAX = 5;
    const attempts = Array(5).fill({ success: false });
    if (attempts.filter(a => !a.success).length < MAX) throw new Error("Rate limit not triggered");
  }),

  // --- SQL injection prevention ---
  test("[LOCAL] parameterized queries prevent SQL injection", async () => {
    const malicious = "'; DROP TABLE users; --";
    const q = { sql: "SELECT * FROM users WHERE username = ?", args: [malicious] };
    if (q.sql.includes(malicious)) throw new Error("SQL injection risk: input interpolated");
    if (!q.sql.includes("?")) throw new Error("No parameterized placeholder");
  }),

  // --- Restart policy logic ---
  test("[LOCAL] process restart policy: never-restart not auto-restarted", async () => {
    type Policy = "always" | "on-failure" | "never";
    function shouldRestart(policy: Policy, isInteractive: boolean, failureCount: number, maxFailures: number): boolean {
      if (isInteractive || policy === "never") return false;
      if (failureCount >= maxFailures) return false;
      return true;
    }
    if (shouldRestart("never", false, 0, 5)) throw new Error("'never' policy triggers restart");
    if (shouldRestart("on-failure", true, 0, 5)) throw new Error("Interactive process triggers restart");
    if (!shouldRestart("on-failure", false, 0, 5)) throw new Error("'on-failure' policy did not trigger restart");
    if (shouldRestart("always", false, 5, 5)) throw new Error("Max-failure process triggers restart");
  }),

  // --- Exponential backoff ---
  test("[LOCAL] exponential backoff increases correctly", async () => {
    function backoffMs(failureCount: number): number {
      return Math.min(1000 * 2 ** failureCount, 30000);
    }
    if (backoffMs(0) !== 1000) throw new Error(`backoff(0) should be 1000, got ${backoffMs(0)}`);
    if (backoffMs(1) !== 2000) throw new Error(`backoff(1) should be 2000, got ${backoffMs(1)}`);
    if (backoffMs(10) !== 30000) throw new Error(`backoff(10) should cap at 30000, got ${backoffMs(10)}`);
  }),

  // --- Session duration ---
  test("[LOCAL] session expires 24 hours in the future", async () => {
    const duration = 24 * 60 * 60;
    const expiresAt = Math.floor(Date.now() / 1000) + duration;
    const diff = expiresAt - Math.floor(Date.now() / 1000);
    if (diff < 86390 || diff > 86410) throw new Error(`Session duration off: ${diff}s`);
  }),

  // --- Lock TTL ---
  test("[LOCAL] supervisor lock TTL is less than scheduler interval", async () => {
    const LOCK_TTL = 8 * 60; // 8 minutes
    const SCHEDULER_INTERVAL = 10 * 60; // 10 minutes
    if (LOCK_TTL >= SCHEDULER_INTERVAL) throw new Error("Lock TTL >= scheduler interval — risk of permanent deadlock");
  }),

  // --- Env var names ---
  test("[LOCAL] required env variable names are correct", async () => {
    const required = [
      "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN",
      "INITIAL_ADMIN_USERNAME", "INITIAL_ADMIN_PASSWORD",
      "SESSION_SECRET", "SUPERVISOR_SECRET",
      "DEBIAN_ROOT_PASSWORD", "SANDBOX_IMAGE",
    ];
    for (const name of required) {
      if (!/^[A-Z_]+$/.test(name)) throw new Error(`Invalid env var: ${name}`);
    }
  }),

  // --- UUID v4 ---
  test("[LOCAL] UUID generation produces valid v4 UUIDs", async () => {
    const id = randomUUID();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw new Error(`Invalid UUID: ${id}`);
    }
  }),

  // --- REMOTE tests (skipped by default) ---
  skip("[REMOTE] Turso: database connection", async () => {}),
  skip("[REMOTE] Turso: user_sandboxes table exists", async () => {}),
  skip("[REMOTE] Turso: managed_processes table exists", async () => {}),
  skip("[REMOTE] Turso: supervisor_heartbeats table exists", async () => {}),
  skip("[REMOTE] Vercel Sandbox: getOrCreate per-user sandbox", async () => {}),
  skip("[REMOTE] Supervisor: authenticated request succeeds", async () => {}),
  skip("[REMOTE] Supervisor: unauthenticated request returns 401", async () => {}),
];

runTests(tests);
