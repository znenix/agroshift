import { NextResponse, type NextRequest } from "next/server";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE_S, splitLangParam } from "@/lib/i18n";

/**
 * SPEC §7: `?lang=xx` beats every other language source. Store it in the `lang` cookie and redirect to
 * the same URL without the parameter, so the cookie is the single source of truth and a later choice in
 * the language switcher is never overridden by a stale URL. Runs only on requests that carry `lang`
 * (see `config`); it makes no data calls.
 */
export function proxy(request: NextRequest) {
  const split = splitLangParam(new URL(request.url));
  if (split === null) return NextResponse.next();

  const response = NextResponse.redirect(split.location);
  if (split.lang !== null) {
    response.cookies.set(LANG_COOKIE, split.lang, { path: "/", maxAge: LANG_COOKIE_MAX_AGE_S, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|data/|favicon.ico).*)",
      has: [{ type: "query", key: "lang" }],
    },
  ],
};
