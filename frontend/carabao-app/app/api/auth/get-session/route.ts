import { auth } from "@/lib/auth";
import { displayEmail } from "@/lib/phone";
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
          // null for a phone signup that hasn't added an email
          email: displayEmail(session.user.email),
          name: session.user.name,
          phoneNumber: (session.user as { phoneNumber?: string | null }).phoneNumber ?? null,
          role: session.user.role ?? null,
        },
      },
    });
  } catch {
    return NextResponse.json({ session: null });
  }
}
