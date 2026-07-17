import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/login";
const WEB_SESSION_COOKIE_NAME = "hermes_web_session";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/platform/login") {
    return NextResponse.next();
  }
  const hasWebSession = Boolean(request.cookies.get(WEB_SESSION_COOKIE_NAME));
  if (hasWebSession) return NextResponse.next();

  const loginPath = request.nextUrl.pathname.startsWith("/platform")
    ? "/platform/login"
    : LOGIN_PATH;
  const loginUrl = new URL(loginPath, request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/organizations/:path*",
    "/settings/:path*",
    "/tickets/:path*",
    "/platform/:path*",
  ],
};
