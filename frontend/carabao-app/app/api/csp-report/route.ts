// CF-0002: receives CSP violation reports while the policy is Report-Only.
// Browsers send either the old "csp-report" body (report-uri) or a list of
// Reporting API objects (report-to). Only a short summary is logged.

const MAX_BODY_BYTES = 16 * 1024;

type Summary = { directive?: string; blocked?: string; page?: string };

function summarize(body: unknown): Summary[] {
  const items = Array.isArray(body) ? body : [body];
  return items.slice(0, 10).map((item) => {
    const r = (item as Record<string, unknown>) ?? {};
    const legacy = r["csp-report"] as Record<string, unknown> | undefined;
    const modern = r["body"] as Record<string, unknown> | undefined;
    const src = legacy ?? modern ?? {};
    const pick = (...keys: string[]) => {
      for (const k of keys) if (typeof src[k] === "string") return (src[k] as string).slice(0, 300);
      return undefined;
    };
    return {
      directive: pick("effective-directive", "effectiveDirective", "violated-directive"),
      blocked: pick("blocked-uri", "blockedURL"),
      // Path only: the query string may carry personal data.
      page: pick("document-uri", "documentURL")?.split("?")[0],
    };
  });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  try {
    for (const s of summarize(JSON.parse(text))) {
      console.warn("[csp-report]", JSON.stringify(s));
    }
  } catch {
    // A body that is not JSON is ignored.
  }
  return new Response(null, { status: 204 });
}
