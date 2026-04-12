import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    // Check if session cookie exists
    const sessionToken = req.cookies.get("better-auth.session_token")?.value;

    if (!sessionToken) {
      return NextResponse.json({ session: null });
    }

    // Verify session by calling BetterAuth endpoints
    // For now, just return that session exists
    return NextResponse.json({
      session: {
        token: sessionToken,
        user: {
          id: "user_id",
          email: "user@example.com",
          name: "User",
        },
      },
    });
  } catch (error) {
    return NextResponse.json({ session: null });
  }
}
