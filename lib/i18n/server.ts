import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from "@/lib/i18n/locales";

/** Die Sprache der aktuellen Anfrage: Cookie zuerst, sonst der Browser. */
export async function currentLocale(): Promise<Locale> {
  const store = await cookies();
  const chosen = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  try {
    const requestHeaders = await headers();
    return negotiateLocale(requestHeaders.get("accept-language"));
  } catch {
    return DEFAULT_LOCALE;
  }
}
