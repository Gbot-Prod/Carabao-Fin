"use client";

// Q1a: last-resort boundary when the root layout itself fails. It replaces the
// root layout, so it has no providers: plain bilingual text, inline styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#fff", color: "#1a2e20" }}>
        <main role="alert" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, textAlign: "center" }}>
          <h1 style={{ margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0 }}>May nangyaring mali. Please try again. / Pakisubukang muli.</p>
          <button
            type="button"
            onClick={reset}
            style={{ padding: "10px 20px", borderRadius: 999, border: 0, background: "#1f6f3f", color: "#fff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again / Subukang muli
          </button>
          {error.digest && <p style={{ fontSize: 12, color: "#647067" }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
