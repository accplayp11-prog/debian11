"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import TerminalClient from "./TerminalClient";

interface Props {
  username: string;
  isAdmin: boolean;
}

type ConnectionStatus =
  | "idle"
  | "initializing"
  | "connected"
  | "disconnected"
  | "error";

export default function TerminalDashboard({ username, isAdmin }: Props) {
  const router = useRouter();
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [terminalUrl, setTerminalUrl] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [sandboxStatus, setSandboxStatus] = useState<string>("unknown");
  const [initTime, setInitTime] = useState<number | null>(null);

  const initializeSandbox = useCallback(async () => {
    setConnectionStatus("initializing");
    setErrorMessage("");
    const startTime = Date.now();

    try {
      const res = await fetch("/api/sandbox", {
        method: "POST",
        credentials: "include",
      });

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to initialize terminal");
      }

      setTerminalUrl(data.terminalUrl);
      setSandboxStatus(data.status?.status || "running");
      setConnectionStatus("connected");
      setInitTime(Math.round((Date.now() - startTime) / 1000));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to start terminal";
      setErrorMessage(msg);
      setConnectionStatus("error");
    }
  }, [router]);

  // Auto-initialize on mount
  useEffect(() => {
    initializeSandbox();
  }, [initializeSandbox]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
  };

  const statusColor = {
    idle: "var(--text-muted)",
    initializing: "var(--warning)",
    connected: "var(--success)",
    disconnected: "var(--error)",
    error: "var(--error)",
  }[connectionStatus];

  const statusLabel = {
    idle: "Idle",
    initializing: "Starting sandbox…",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
  }[connectionStatus];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--bg-primary)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1.25rem",
          height: "56px",
          background: "var(--bg-secondary)",
          borderBottom: "1px solid var(--border-color)",
          flexShrink: 0,
          gap: "1rem",
        }}
      >
        {/* Left: Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <div>
            <div
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Debian Web Terminal
            </div>
            <div
              style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}
            >
              Debian GNU/Linux 11 (Bullseye)
            </div>
          </div>
        </div>

        {/* Center: Status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.8125rem",
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: statusColor,
              display: "inline-block",
              boxShadow:
                connectionStatus === "connected"
                  ? `0 0 6px ${statusColor}`
                  : "none",
              animation:
                connectionStatus === "initializing"
                  ? "pulse 1.5s ease-in-out infinite"
                  : "none",
            }}
          />
          <span style={{ color: "var(--text-secondary)" }}>{statusLabel}</span>
          {initTime !== null && connectionStatus === "connected" && (
            <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
              ({initTime}s)
            </span>
          )}
        </div>

        {/* Right: User + Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-color)",
              borderRadius: "8px",
              padding: "0.3125rem 0.625rem",
            }}
          >
            <div
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.6875rem",
                fontWeight: 700,
                color: "white",
              }}
            >
              {username[0]?.toUpperCase()}
            </div>
            <span
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-primary)",
                fontWeight: 500,
              }}
            >
              {username}
            </span>
            {isAdmin && (
              <span
                style={{
                  fontSize: "0.625rem",
                  background: "rgba(124,58,237,0.2)",
                  color: "var(--accent-light)",
                  borderRadius: "4px",
                  padding: "0.125rem 0.375rem",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Admin
              </span>
            )}
          </div>

          {connectionStatus === "error" && (
            <button
              onClick={initializeSandbox}
              style={{
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.3)",
                color: "#fbbf24",
                borderRadius: "7px",
                padding: "0.3125rem 0.75rem",
                fontSize: "0.8125rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reconnect
            </button>
          )}

          <button
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "1px solid var(--border-color)",
              color: "var(--text-secondary)",
              borderRadius: "7px",
              padding: "0.3125rem 0.75rem",
              fontSize: "0.8125rem",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLButtonElement).style.borderColor =
                "var(--error)";
              (e.target as HTMLButtonElement).style.color = "#fca5a5";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLButtonElement).style.borderColor =
                "var(--border-color)";
              (e.target as HTMLButtonElement).style.color =
                "var(--text-secondary)";
            }}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "1px",
        }}
      >
        {connectionStatus === "initializing" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              color: "var(--text-secondary)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                border: "3px solid var(--border-color)",
                borderTopColor: "var(--accent-primary)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                Starting Debian Sandbox…
              </p>
              <p
                style={{
                  fontSize: "0.8125rem",
                  marginTop: "0.5rem",
                  color: "var(--text-muted)",
                }}
              >
                This may take 10–30 seconds on first boot
              </p>
            </div>
          </div>
        )}

        {connectionStatus === "error" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--error-bg)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "12px",
                padding: "1.5rem 2rem",
                maxWidth: "480px",
                width: "100%",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "2rem",
                  marginBottom: "0.75rem",
                }}
              >
                ⚠️
              </div>
              <h2
                style={{
                  color: "#fca5a5",
                  fontWeight: 600,
                  marginBottom: "0.5rem",
                }}
              >
                Connection Failed
              </h2>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: "0.875rem",
                  marginBottom: "1rem",
                }}
              >
                {errorMessage}
              </p>
              <button
                onClick={initializeSandbox}
                style={{
                  background:
                    "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  padding: "0.625rem 1.25rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {connectionStatus === "connected" && terminalUrl && (
          <TerminalClient
            terminalUrl={terminalUrl}
            onDisconnect={() => setConnectionStatus("disconnected")}
          />
        )}

        {connectionStatus === "disconnected" && (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
            }}
          >
            <p style={{ color: "var(--text-secondary)" }}>
              Terminal disconnected.
            </p>
            <button
              onClick={initializeSandbox}
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)",
                color: "white",
                border: "none",
                borderRadius: "8px",
                padding: "0.625rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reconnect
            </button>
          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
