"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Login failed. Please try again."); return; }
      router.push("/terminal");
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const inp: React.CSSProperties = {
    background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
    borderRadius: 8, padding: "0.625rem 0.875rem", color: "var(--text-primary)",
    fontSize: "0.9375rem", outline: "none", transition: "border-color 0.15s", width: "100%",
  };

  return (
    <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Logo / Header */}
      <div style={{ textAlign: "center", marginBottom: "0.25rem" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 14, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", marginBottom: "1rem", boxShadow: "0 0 32px rgba(124,58,237,0.4)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.025em" }}>
          Debian Web Terminal
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
          Debian GNU/Linux 11 (Bullseye)
        </p>
      </div>

      {/* Login Card */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 12, padding: "2rem" }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {error && (
            <div style={{ background: "var(--error-bg)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "0.75rem 1rem", color: "#fca5a5", fontSize: "0.875rem", display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
              <span style={{ flexShrink: 0 }}>⚠</span><span>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label htmlFor="username" style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-secondary)" }}>Username</label>
            <input id="username" type="text" value={username} onChange={e => setUsername(e.target.value)}
              autoComplete="username" autoFocus required disabled={loading} placeholder="Enter username"
              style={inp}
              onFocus={e => (e.target.style.borderColor = "var(--border-focus)")}
              onBlur={e => (e.target.style.borderColor = "var(--border-color)")}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label htmlFor="password" style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-secondary)" }}>Password</label>
            <div style={{ position: "relative" }}>
              <input id="password" type={showPassword ? "text" : "password"} value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                required disabled={loading} placeholder="Enter password"
                style={{ ...inp, padding: "0.625rem 2.5rem 0.625rem 0.875rem" }}
                onFocus={e => (e.target.style.borderColor = "var(--border-focus)")}
                onBlur={e => (e.target.style.borderColor = "var(--border-color)")}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                style={{ position: "absolute", right: "0.75rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.25rem", display: "flex", alignItems: "center" }}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            style={{ background: loading ? "rgba(124,58,237,0.5)" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", border: "none", borderRadius: 8, padding: "0.75rem 1rem", fontSize: "0.9375rem", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginTop: "0.25rem", boxShadow: loading ? "none" : "0 4px 15px rgba(124,58,237,0.35)" }}
          >
            {loading ? (
              <>
                <span style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                Authenticating…
              </>
            ) : "Sign In"}
          </button>
        </form>
      </div>

      {/* Contact Developer */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "1rem 1.25rem" }}>
        <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem", textAlign: "center", letterSpacing: "0.04em" }}>
          CONTACT DEVELOPER
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "1.5rem" }}>
          {/* GitHub */}
          <a
            href="https://github.com/yassinejss"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", textDecoration: "none", fontSize: "0.875rem", padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-secondary)", transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent-primary)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border-color)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}
          >
            {/* GitHub icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            yassinejss
          </a>

          {/* Discord */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", fontSize: "0.875rem", padding: "0.5rem 0.875rem", borderRadius: 8, border: "1px solid var(--border-color)", background: "var(--bg-secondary)", userSelect: "all" as const, cursor: "default" }}
            title="Discord username: yassinejs"
          >
            {/* Discord icon */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
            </svg>
            yassinejs
          </div>
        </div>
      </div>

      <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        Access restricted to authorized users only.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
