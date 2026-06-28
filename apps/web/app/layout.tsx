import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { AdminShell } from "@/components/admin-shell";
import { AppearanceController } from "@/components/appearance-controller";
import { TooltipProvider } from "@/components/ui/tooltip";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Hermes Swarm Console",
  description: "Operational console for Hermes Swarm.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className={cn("font-sans", geist.variable)}>
      <body>
        <AppearanceController />
        <TooltipProvider>
          <AdminShell>{children}</AdminShell>
        </TooltipProvider>
      </body>
    </html>
  );
}
