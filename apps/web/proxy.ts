import { NextResponse, type NextRequest } from "next/server";

const LOGIN_PATH = "/login";
const WEB_SESSION_COOKIE_NAME = "hermes_web_session";

export function proxy(request: NextRequest) {
  const hasWebSession = Boolean(request.cookies.get(WEB_SESSION_COOKIE_NAME));
  if (hasWebSession) return NextResponse.next();

  const isPlatform = request.nextUrl.pathname.startsWith("/platform");
  const loginUrl = new URL(LOGIN_PATH, request.url);
  if (isPlatform) loginUrl.searchParams.set("context", "platform");
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/home/:path*",
    "/settings/:path*",
    "/tickets/:path*",
    "/platform/:path*",
  ],
};
