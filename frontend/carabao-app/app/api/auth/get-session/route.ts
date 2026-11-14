import { auth } from "@/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const useMockSession = process.env.MOCK_AUTH_SESSION === "true";

    if (useMockSession) {
      return NextResponse.json({
        session: {
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

    return NextResponse.json({
      session: {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role ?? null,
        },
      },
    });
  } catch {
    return NextResponse.json({ session: null });
  }
}
