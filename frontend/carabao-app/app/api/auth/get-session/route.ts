import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const useMockSession = process.env.MOCK_AUTH_SESSION === "true";

    if (useMockSession) {
      return NextResponse.json({
        session: {
          token: "mock-session-token",
          user: {
            id: "mock_user_id",
            email: "mock.user@carabao.local",
            name: "Mock User",
          },
        },
      });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ session: null });
    }

    const backendToken = req.cookies.get("backend_access_token")?.value;

    return NextResponse.json({
      session: {
        token: session.session.token,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        },
        backendAuthenticated: !!backendToken,
      },
    });
  } catch {
    return NextResponse.json({ session: null });
  }
}
