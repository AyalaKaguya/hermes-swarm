import "./globals.css";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { cn } from "@/lib/utils";
import { NotificationProvider } from "@/components/app-notifications";
import { AppearanceController } from "@/components/appearance-controller";
import { I18nProvider } from "@/components/i18n-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APPEARANCE_BOOTSTRAP_SCRIPT } from "@/lib/appearance-bootstrap";
import {
  getMessagesForLanguage,
  normalizeLanguagePreference,
  normalizeTimeZonePreference,
  TIME_ZONE_STORAGE_KEY,
} from "@/lib/i18n";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export async function generateMetadata(): Promise<Metadata> {
  const locale = normalizeLanguagePreference(await getLocale());
  const messages = getMessagesForLanguage(locale) as {
    metadata?: { description?: string; title?: string };
  };

  return {
    description: messages.metadata?.description,
    title: messages.metadata?.title,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = normalizeLanguagePreference(await getLocale());
  const messages = getMessagesForLanguage(locale);
  const cookieStore = await cookies();
  const initialTimeZone = normalizeTimeZonePreference(
    cookieStore.get(TIME_ZONE_STORAGE_KEY)?.value,
  );

  return (
    <html
      className={cn("font-sans", geist.variable)}
      lang={locale}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP_SCRIPT }}
          id="hermes-appearance-bootstrap"
        />
      </head>
      <body>
        <I18nProvider
          initialLocale={locale}
          initialMessages={messages}
          initialTimeZone={initialTimeZone}
        >
          <AppearanceController />
          <TooltipProvider>
            <NotificationProvider>
              {children}
            </NotificationProvider>
          </TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
