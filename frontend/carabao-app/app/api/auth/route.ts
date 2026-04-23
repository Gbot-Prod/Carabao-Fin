import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

const rawApiUrl =
  process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_FASTAPI_URL || "";
const normalizedApiUrl = rawApiUrl.trim().replace(/^"|"$/g, "");
const apiBaseUrl = normalizedApiUrl
  ? normalizedApiUrl.startsWith("http")
    ? normalizedApiUrl
    : `https://${normalizedApiUrl}`
  : "";

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  baseDelayMs = 500
): Promise<Response | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, options).catch(() => null);
    if (res?.ok) return res;
    if (attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const useMockSession = process.env.MOCK_AUTH_SESSION === "true";

  if (useMockSession) {
    const mockResponse = NextResponse.json({ ok: true, mock: true });
    mockResponse.cookies.set("backend_access_token", "mock-backend-token", {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60,
    });
    return mockResponse;
  }

  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sharedSecret = process.env.AUTH_SYNC_SHARED_SECRET;
  if (!sharedSecret) {
    return NextResponse.json(
      { error: "AUTH_SYNC_SHARED_SECRET is not configured" },
      { status: 500 }
    );
  }

  const [firstName, ...restNames] = (session.user.name || "").trim().split(" ");
  const lastName = restNames.join(" ");

  if (!apiBaseUrl) {
    return NextResponse.json(
      {
        error:
          "API base URL is not configured. Set NEXT_PUBLIC_API_URL or NEXT_PUBLIC_FASTAPI_URL.",
      },
      { status: 500 }
    );
  }

  const response = await fetchWithRetry(
    `${apiBaseUrl}/auth/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Auth-Sync-Secret": sharedSecret,
      },
      body: JSON.stringify({
        provider_user_id: session.user.id,
        email: session.user.email,
        first_name: firstName || null,
        last_name: lastName || null,
      }),
    }
  );

  if (!response?.ok) {
    return NextResponse.json(
      { error: "Backend auth sync failed" },
      { status: response?.status || 503 }
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const result = NextResponse.json({ ok: true });
  // httpOnly: false so the browser-side apiClient can read this cookie and
  // attach it as an Authorization header when calling FastAPI directly.
  // FastAPI is on a different origin (port) so the browser never sends cookies
  // across that boundary automatically — we have to forward the token ourselves.
  result.cookies.set("backend_access_token", data.access_token, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: data.expires_in ?? 60 * 60,
  });

  return result;
}
