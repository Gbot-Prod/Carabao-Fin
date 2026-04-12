import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // Get session cookie
  const session = request.cookies.get("better-auth.session_token")?.value;

  // Protected routes that require authentication
  const protectedRoutes = ["/app", "/profile", "/merchant", "/order", "/history"];
  const currentPath = request.nextUrl.pathname;

  const isProtectedRoute = protectedRoutes.some((route) =>
    currentPath.startsWith(route)
  );

  // Public routes (no auth required)
  const publicRoutes = ["/landing", "/merchantSignup", "/onboarding", "/login", "/signup"];
  const isPublicRoute = publicRoutes.some((route) =>
    currentPath.startsWith(route)
  );

  // If accessing a protected route without session, redirect to login
  if (isProtectedRoute && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // If accessing a public auth route while authenticated, optionally redirect to app
  if (
    (currentPath === "/login" || currentPath === "/signup") &&
    session
  ) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
