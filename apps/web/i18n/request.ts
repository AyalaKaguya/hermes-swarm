import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  LANGUAGE_STORAGE_KEY,
  getMessagesForLanguage,
  normalizeLanguagePreference,
} from "@/lib/i18n";

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = normalizeLanguagePreference(
    cookieStore.get(LANGUAGE_STORAGE_KEY)?.value,
  );

  return {
    locale,
    messages: getMessagesForLanguage(locale),
    timeZone: "Asia/Hong_Kong",
  };
});
