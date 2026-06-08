"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Root-level error boundary. Fires when the layout itself crashes
 * (anything error.tsx can't catch). Cannot use the root layout here
 * — must render its own <html> + <body>.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#f4f6fb",
          minHeight: "100vh",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          color: "#1a2740",
        }}
      >
        <main
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: 16,
          }}
        >
          <div
            style={{
              maxWidth: 420,
              width: "100%",
              borderRadius: 16,
              background: "white",
              padding: 32,
              boxShadow: "0 4px 20px rgba(15, 23, 42, 0.06)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                margin: "0 auto 12px",
                background: "#fef2f2",
                color: "#b91c1c",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AlertTriangle size={24} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              Application crashed
            </h1>
            <p style={{ marginTop: 8, color: "#64748b", fontSize: 14 }}>
              {error.message || "An unexpected error occurred."}
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                background: "#1f4486",
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "10px 20px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
