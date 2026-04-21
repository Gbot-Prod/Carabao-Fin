import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const useMockSession = process.env.MOCK_AUTH_SESSION === "true";

  // Get session cookie
  const session = request.cookies.get("better-auth.session_token")?.value;

  // Protected routes that require authentication
  const protectedRoutes = ["/profile", "/merchant", "/order", "/history"];
  const currentPath = request.nextUrl.pathname;

  const isProtectedRoute = protectedRoutes.some((route) =>
    currentPath.startsWith(route)
  );

  // If accessing a protected route without session, redirect to auth
  if (isProtectedRoute && !session && !useMockSession) {
    return NextResponse.redirect(new URL("/auth", request.url));
  }

  // If accessing auth while authenticated, redirect to the main app entry route.
  if (
    currentPath === "/auth" &&
    (session || useMockSession)
  ) {
    return NextResponse.redirect(new URL("/order", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
