"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import TerminalClient from "./TerminalClient";

interface Props {
  username: string;
  isAdmin: boolean;
}

type ConnectionStatus = "idle" | "initializing" | "connected" | "disconnected" | "error";
type SidePanel = "none" | "processes";

interface ManagedProcess {
  id: string;
  name: string;
  command: string;
  workingDir: string;
  restartPolicy: string;
  status: string;
  pid?: number;
  failureCount: number;
  maxFailures: number;
  lastStartedAt?: number;
  lastError?: string;
  isInteractive: boolean;
}

export default function TerminalDashboard({ username, isAdmin }: Props) {
  const router = useRouter();
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [terminalUrl, setTerminalUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [initTime, setInitTime] = useState<number | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>("none");

  // Process manager state
  const [processes, setProcesses] = useState<ManagedProcess[]>([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [newProcName, setNewProcName] = useState("");
  const [newProcCmd, setNewProcCmd] = useState("");
  const [newProcDir, setNewProcDir] = useState("/root");
  const [newProcPolicy, setNewProcPolicy] = useState("on-failure");
  const [newProcAutoStart, setNewProcAutoStart] = useState(false);
  const [addingProc, setAddingProc] = useState(false);
  const [procMsg, setProcMsg] = useState("");

  const initializeSandbox = useCallback(async () => {
    setConnectionStatus("initializing");
    setErrorMessage("");
    const startTime = Date.now();
    try {
      const res = await fetch("/api/sandbox", { method: "POST", credentials: "include" });
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to initialize terminal");
      setTerminalUrl(data.terminalUrl);
      setConnectionStatus("connected");
      setInitTime(Math.round((Date.now() - startTime) / 1000));
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to start terminal");
      setConnectionStatus("error");
    }
  }, [router]);

  useEffect(() => { initializeSandbox(); }, [initializeSandbox]);

  const loadProcesses = useCallback(async () => {
    setProcessLoading(true);
    try {
      const res = await fetch("/api/processes", { credentials: "include" });
      const data = await res.json();
      setProcesses(data.processes ?? []);
    } finally {
      setProcessLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sidePanel === "processes") loadProcesses();
  }, [sidePanel, loadProcesses]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    router.push("/login");
  };

  const handleProcAction = async (procId: string, action: "start" | "stop" | "delete") => {
    setProcMsg("");
    const res = await fetch(`/api/processes/${procId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (res.ok) {
      setProcMsg(`Process ${action}ed`);
      loadProcesses();
    } else {
      setProcMsg(`Error: ${data.error}`);
    }
  };

  const handleAddProcess = async () => {
    if (!newProcName || !newProcCmd) { setProcMsg("Name and command are required"); return; }
    setAddingProc(true);
    setProcMsg("");
    try {
      const res = await fetch("/api/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newProcName,
          command: newProcCmd,
          workingDir: newProcDir,
          restartPolicy: newProcPolicy,
          autoStart: newProcAutoStart,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setProcMsg(`Process "${newProcName}" registered`);
        setNewProcName(""); setNewProcCmd(""); setNewProcDir("/root");
        setNewProcAutoStart(false);
        loadProcesses();
      } else {
        setProcMsg(`Error: ${data.error}`);
      }
    } finally {
      setAddingProc(false);
    }
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
    connected: `Connected${initTime ? ` (${initTime}s)` : ""}`,
    disconnected: "Disconnected",
    error: "Error",
  }[connectionStatus];

  function procStatusColor(s: string) {
    return s === "running" ? "var(--success)" : s === "failed" ? "var(--error)" : s === "starting" ? "var(--warning)" : "var(--text-muted)";
  }

  const inputSt: React.CSSProperties = {
    background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
    borderRadius: 7, padding: "0.5rem 0.75rem", color: "var(--text-primary)",
    fontSize: "0.8125rem", width: "100%", outline: "none",
  };
  const btnSm: React.CSSProperties = {
    border: "none", borderRadius: 5, padding: "0.25rem 0.625rem",
    fontSize: "0.75rem", fontWeight: 500, cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg-primary)", overflow: "hidden" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1.25rem", height: 56, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)", flexShrink: 0, gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>Debian Web Terminal</div>
            <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>Debian GNU/Linux 11 (Bullseye)</div>
          </div>
        </div>

        {/* Status */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8125rem" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: statusColor, display: "inline-block",
            boxShadow: connectionStatus === "connected" ? `0 0 6px ${statusColor}` : "none",
            animation: connectionStatus === "initializing" ? "pulse 1.5s ease-in-out infinite" : "none" }} />
          <span style={{ color: "var(--text-secondary)" }}>{statusLabel}</span>
        </div>

        {/* Right actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* User badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--bg-hover)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "0.3125rem 0.625rem" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.6875rem", fontWeight: 700, color: "white" }}>
              {username[0]?.toUpperCase()}
            </div>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-primary)", fontWeight: 500 }}>{username}</span>
            {isAdmin && (
              <span style={{ fontSize: "0.625rem", background: "rgba(124,58,237,0.2)", color: "var(--accent-light)", borderRadius: 4, padding: "0.125rem 0.375rem", fontWeight: 600 }}>
                Admin
              </span>
            )}
          </div>

          {/* Process manager toggle */}
          <button
            onClick={() => setSidePanel(sidePanel === "processes" ? "none" : "processes")}
            title="Background Processes"
            style={{ background: sidePanel === "processes" ? "rgba(124,58,237,0.15)" : "transparent", border: `1px solid ${sidePanel === "processes" ? "rgba(124,58,237,0.4)" : "var(--border-color)"}`, color: sidePanel === "processes" ? "var(--accent-light)" : "var(--text-secondary)", borderRadius: 7, padding: "0.3125rem 0.75rem", fontSize: "0.8125rem", cursor: "pointer" }}
          >
            ⚙ Processes
            {processes.filter(p => p.status === "running").length > 0 && (
              <span style={{ marginLeft: 5, background: "var(--success)", color: "white", borderRadius: 10, padding: "0 5px", fontSize: "0.6875rem" }}>
                {processes.filter(p => p.status === "running").length}
              </span>
            )}
          </button>

          {isAdmin && (
            <button
              onClick={() => router.push("/admin")}
              style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", color: "var(--accent-light)", borderRadius: 7, padding: "0.3125rem 0.75rem", fontSize: "0.8125rem", cursor: "pointer" }}
            >
              Admin
            </button>
          )}

          {connectionStatus === "error" && (
            <button onClick={initializeSandbox} style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", color: "#fbbf24", borderRadius: 7, padding: "0.3125rem 0.75rem", fontSize: "0.8125rem", cursor: "pointer" }}>
              Reconnect
            </button>
          )}

          <button onClick={handleLogout} style={{ background: "transparent", border: "1px solid var(--border-color)", color: "var(--text-secondary)", borderRadius: 7, padding: "0.3125rem 0.75rem", fontSize: "0.8125rem", cursor: "pointer" }}>
            Logout
          </button>
        </div>
      </header>

      {/* Main: terminal + optional side panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Terminal area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {connectionStatus === "initializing" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem", color: "var(--text-secondary)" }}>
              <div style={{ width: 48, height: 48, border: "3px solid var(--border-color)", borderTopColor: "var(--accent-primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <div style={{ textAlign: "center" }}>
                <p style={{ fontWeight: 500, color: "var(--text-primary)" }}>Starting your Debian Sandbox…</p>
                <p style={{ fontSize: "0.8125rem", marginTop: "0.5rem", color: "var(--text-muted)" }}>This may take 15–45 seconds on first boot</p>
                <p style={{ fontSize: "0.75rem", marginTop: "0.25rem", color: "var(--text-muted)" }}>Your filesystem is persistent across sessions</p>
              </div>
            </div>
          )}

          {connectionStatus === "error" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ background: "var(--error-bg)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "1.5rem 2rem", maxWidth: 480, textAlign: "center" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>⚠️</div>
                <h2 style={{ color: "#fca5a5", fontWeight: 600, marginBottom: "0.5rem" }}>Connection Failed</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "1rem" }}>{errorMessage}</p>
                <button onClick={initializeSandbox} style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", border: "none", borderRadius: 8, padding: "0.625rem 1.25rem", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
                  Try Again
                </button>
              </div>
            </div>
          )}

          {connectionStatus === "connected" && terminalUrl && (
            <TerminalClient terminalUrl={terminalUrl} onDisconnect={() => setConnectionStatus("disconnected")} />
          )}

          {connectionStatus === "disconnected" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
              <p style={{ color: "var(--text-secondary)" }}>Terminal disconnected.</p>
              <button onClick={initializeSandbox} style={{ background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", border: "none", borderRadius: 8, padding: "0.625rem 1.25rem", fontSize: "0.875rem", fontWeight: 500, cursor: "pointer" }}>
                Reconnect
              </button>
            </div>
          )}
        </main>

        {/* Process Manager Side Panel */}
        {sidePanel === "processes" && (
          <aside style={{ width: 360, background: "var(--bg-secondary)", borderLeft: "1px solid var(--border-color)", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
            <div style={{ padding: "1rem", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.875rem" }}>Background Processes</div>
                <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginTop: 2 }}>Restart after sandbox recovery</div>
              </div>
              <button onClick={loadProcesses} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem" }}>↺</button>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: "0.75rem" }}>
              {/* Message */}
              {procMsg && (
                <div style={{ background: procMsg.startsWith("Error") ? "var(--error-bg)" : "var(--success-bg)", border: `1px solid ${procMsg.startsWith("Error") ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`, borderRadius: 7, padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: procMsg.startsWith("Error") ? "#fca5a5" : "var(--success)", marginBottom: "0.75rem" }}>
                  {procMsg}
                </div>
              )}

              {/* Process list */}
              {processLoading ? (
                <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8125rem", padding: "1rem" }}>Loading…</p>
              ) : processes.length === 0 ? (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.8125rem", padding: "1.5rem 0.5rem" }}>
                  <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>⚙</div>
                  <p>No managed processes yet.</p>
                  <p style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>Add a background service below.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", marginBottom: "1rem" }}>
                  {processes.map((p) => (
                    <div key={p.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                        <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.8125rem" }}>{p.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: procStatusColor(p.status), display: "inline-block" }} />
                          <span style={{ fontSize: "0.6875rem", color: "var(--text-muted)" }}>{p.status}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: "0.5rem", wordBreak: "break-all" }}>
                        {p.command.length > 60 ? p.command.substring(0, 60) + "…" : p.command}
                      </div>
                      {p.lastError && (
                        <div style={{ fontSize: "0.6875rem", color: "#fca5a5", marginBottom: "0.5rem", padding: "0.25rem 0.5rem", background: "var(--error-bg)", borderRadius: 4 }}>
                          {p.lastError.substring(0, 100)}
                        </div>
                      )}
                      <div style={{ fontSize: "0.6875rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                        Policy: {p.restartPolicy} · Failures: {p.failureCount}/{p.maxFailures}
                      </div>
                      <div style={{ display: "flex", gap: "0.375rem" }}>
                        {p.status !== "running" && !p.isInteractive && (
                          <button onClick={() => handleProcAction(p.id, "start")} style={{ ...btnSm, background: "var(--success-bg)", color: "var(--success)" }}>Start</button>
                        )}
                        {p.status === "running" && (
                          <button onClick={() => handleProcAction(p.id, "stop")} style={{ ...btnSm, background: "var(--warning-bg)", color: "var(--warning)" }}>Stop</button>
                        )}
                        <button onClick={() => handleProcAction(p.id, "delete")} style={{ ...btnSm, background: "var(--error-bg)", color: "#fca5a5" }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add process form */}
              <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: 8, padding: "0.875rem" }}>
                <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>Register Process</div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <input style={inputSt} placeholder="Process name" value={newProcName} onChange={e => setNewProcName(e.target.value)} />
                  <textarea
                    style={{ ...inputSt, resize: "vertical", minHeight: 60, fontFamily: "var(--font-mono)" }}
                    placeholder="Command (e.g. python3 /root/bot.py)"
                    value={newProcCmd}
                    onChange={e => setNewProcCmd(e.target.value)}
                  />
                  <input style={{ ...inputSt, fontFamily: "var(--font-mono)" }} placeholder="Working dir (/root)" value={newProcDir} onChange={e => setNewProcDir(e.target.value)} />
                  <select style={{ ...inputSt, cursor: "pointer" }} value={newProcPolicy} onChange={e => setNewProcPolicy(e.target.value)}>
                    <option value="on-failure">on-failure (restart after crash)</option>
                    <option value="always">always (restart after any stop)</option>
                    <option value="never">never (manual only)</option>
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                    <input type="checkbox" checked={newProcAutoStart} onChange={e => setNewProcAutoStart(e.target.checked)} style={{ accentColor: "var(--accent-primary)" }} />
                    Start immediately after registering
                  </label>
                  <button
                    onClick={handleAddProcess}
                    disabled={addingProc}
                    style={{ background: addingProc ? "rgba(124,58,237,0.4)" : "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", border: "none", borderRadius: 7, padding: "0.5rem", fontSize: "0.8125rem", fontWeight: 500, cursor: addingProc ? "not-allowed" : "pointer" }}
                  >
                    {addingProc ? "Registering…" : "Register Process"}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: "0.75rem", padding: "0.625rem", background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 7, fontSize: "0.6875rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                <strong style={{ color: "var(--info)" }}>Recovery:</strong> After a 45-min Sandbox session expires, the external supervisor resumes your sandbox and restarts registered processes (up to 10 min delay).
              </div>
            </div>
          </aside>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
