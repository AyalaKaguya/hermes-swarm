import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { getLocale, getMessages } from "next-intl/server";
import { cn } from "@/lib/utils";
import { NotificationProvider } from "@/components/app-notifications";
import { AppearanceController } from "@/components/appearance-controller";
import { I18nProvider } from "@/components/i18n-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { normalizeLanguagePreference } from "@/lib/i18n";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Hermes Swarm Console",
  description: "Operational console for Hermes Swarm.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = normalizeLanguagePreference(await getLocale());
  const messages = await getMessages();

  return (
    <html
      className={cn("font-sans", geist.variable)}
      lang={locale}
      suppressHydrationWarning
    >
      <body>
        <I18nProvider initialLocale={locale} initialMessages={messages}>
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
