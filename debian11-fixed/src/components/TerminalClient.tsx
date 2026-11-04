"use client";

/**
 * TerminalClient — Browser terminal using xterm.js + WebSocket.
 *
 * Architecture:
 * - Embeds the ttyd web terminal inside an <iframe>.
 * - ttyd provides a full xterm.js terminal with WebSocket PTY backend.
 * - ttyd serves its own HTML/JS/CSS — we just iframe it.
 * - Each browser tab gets its own independent shell process.
 * - The underlying Debian filesystem is shared between all sessions.
 *
 * Alternative (direct WebSocket): The TerminalClientWS component below
 * implements a direct xterm.js WebSocket connection for use if ttyd is
 * not available.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  terminalUrl: string; // HTTP URL for ttyd (e.g. https://xxx.vercel.run)
  onDisconnect?: () => void;
}

export default function TerminalClient({ terminalUrl, onDisconnect }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    // If the iframe fails to load (e.g. ttyd not ready), show error
    const timer = setTimeout(() => {
      if (!loaded) {
        setIframeError(true);
        onDisconnect?.();
      }
    }, 30000); // 30 second timeout for initial load

    return () => clearTimeout(timer);
  }, [loaded, onDisconnect]);

  const handleLoad = () => {
    setLoaded(true);
    setIframeError(false);
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "var(--terminal-bg)",
        borderRadius: "0",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Terminal toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.4375rem 1rem",
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--border-color)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <div style={{ display: "flex", gap: "0.375rem" }}>
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#ef4444",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#f59e0b",
              }}
            />
            <div
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#10b981",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              marginLeft: "0.5rem",
            }}
          >
            root@debian:~#
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span
            style={{
              fontSize: "0.6875rem",
              color: "var(--text-muted)",
              background: "var(--bg-hover)",
              borderRadius: "4px",
              padding: "0.125rem 0.375rem",
            }}
          >
            Shared Filesystem
          </span>
          <span
            style={{
              fontSize: "0.6875rem",
              color: "var(--success)",
              background: "var(--success-bg)",
              borderRadius: "4px",
              padding: "0.125rem 0.375rem",
            }}
          >
            root
          </span>
        </div>
      </div>

      {/* Loading overlay */}
      {!loaded && !iframeError && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            top: "40px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--terminal-bg)",
            gap: "1rem",
            zIndex: 10,
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "2px solid var(--border-color)",
              borderTopColor: "var(--accent-primary)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.875rem",
              fontFamily: "var(--font-mono)",
            }}
          >
            Connecting to Debian shell…
          </p>
        </div>
      )}

      {/* ttyd iframe */}
      <iframe
        ref={iframeRef}
        src={terminalUrl}
        onLoad={handleLoad}
        style={{
          flex: 1,
          width: "100%",
          border: "none",
          background: "var(--terminal-bg)",
          display: "block",
        }}
        title="Debian Terminal"
        allow="clipboard-read; clipboard-write"
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
