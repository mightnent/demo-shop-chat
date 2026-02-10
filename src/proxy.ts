import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/ucp",
  "/api/auth/exchange",
  "/api/auth/me",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets and public paths pass through
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Auth not enabled — allow everything
  const authEnabled =
    process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
  if (!authEnabled) {
    return NextResponse.next();
  }

  // Public paths pass through
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Protected paths require session cookie presence
  // (Actual role validation happens in route handlers)
  const sessionCookie = request.cookies.get("chathost_session");
  if (!sessionCookie) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Redirect to home for page requests
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
