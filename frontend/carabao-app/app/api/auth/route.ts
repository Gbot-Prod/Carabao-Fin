// This file is for any custom auth API endpoints
// For example, syncing with your FastAPI backend

import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

// Example: Verify token with backend
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional: Sync session with your FastAPI backend
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/auth/verify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.session.token}`,
      },
      body: JSON.stringify({ userId: session.user.id }),
    }
  ).catch(() => null);

  if (!response?.ok) {
    return NextResponse.json(
      { error: "Backend verification failed" },
      { status: 401 }
    );
  }

  return NextResponse.json({ authenticated: true });
}
