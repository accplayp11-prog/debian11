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

      if (!res.ok) {
        setError(data.message || "Login failed. Please try again.");
        return;
      }

      router.push("/terminal");
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "420px",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}
    >
      {/* Logo / Header */}
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "56px",
            height: "56px",
            borderRadius: "14px",
            background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
            marginBottom: "1rem",
            boxShadow: "0 0 32px rgba(124,58,237,0.4)",
          }}
        >
          {/* Terminal icon */}
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            letterSpacing: "-0.025em",
          }}
        >
          Debian Web Terminal
        </h1>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--text-secondary)",
            marginTop: "0.25rem",
          }}
        >
          Debian GNU/Linux 11 (Bullseye)
        </p>
      </div>

      {/* Login Card */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-color)",
          borderRadius: "12px",
          padding: "2rem",
        }}
      >
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Error message */}
          {error && (
            <div
              style={{
                background: "var(--error-bg)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px",
                padding: "0.75rem 1rem",
                color: "#fca5a5",
                fontSize: "0.875rem",
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
              }}
            >
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Username field */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label
              htmlFor="username"
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
              }}
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={loading}
              placeholder="Enter username"
              style={{
                background: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "8px",
                padding: "0.625rem 0.875rem",
                color: "var(--text-primary)",
                fontSize: "0.9375rem",
                outline: "none",
                transition: "border-color 0.15s",
                width: "100%",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "var(--border-focus)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "var(--border-color)")
              }
            />
          </div>

          {/* Password field */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label
              htmlFor="password"
              style={{
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
              }}
            >
              Password
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
                placeholder="Enter password"
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "8px",
                  padding: "0.625rem 2.5rem 0.625rem 0.875rem",
                  color: "var(--text-primary)",
                  fontSize: "0.9375rem",
                  outline: "none",
                  transition: "border-color 0.15s",
                  width: "100%",
                }}
                onFocus={(e) =>
                  (e.target.style.borderColor = "var(--border-focus)")
                }
                onBlur={(e) =>
                  (e.target.style.borderColor = "var(--border-color)")
                }
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "0.75rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: "0.25rem",
                  display: "flex",
                  alignItems: "center",
                }}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  /* Eye-off icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  /* Eye icon */
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: loading
                ? "rgba(124,58,237,0.5)"
                : "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              color: "white",
              border: "none",
              borderRadius: "8px",
              padding: "0.75rem 1rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginTop: "0.25rem",
              boxShadow: loading ? "none" : "0 4px 15px rgba(124,58,237,0.35)",
            }}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: "16px",
                    height: "16px",
                    border: "2px solid rgba(255,255,255,0.3)",
                    borderTopColor: "white",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
                Authenticating...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>
      </div>

      {/* Footer note */}
      <p
        style={{
          textAlign: "center",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        Access to this system is restricted to authorized users only.
      </p>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
