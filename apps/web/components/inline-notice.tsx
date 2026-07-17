import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type InlineNoticeProps = {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  tone?: "error" | "info" | "success";
};

export function InlineNotice({
  children,
  className,
  title,
  tone = "info",
}: InlineNoticeProps) {
  return (
    <Alert
      className={cn(
        tone === "info" && "bg-muted/35",
        tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        className,
      )}
      role={tone === "error" ? "alert" : "status"}
      variant={tone === "error" ? "destructive" : "default"}
    >
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className={cn(tone === "success" && "text-current/90")}>
        {children}
      </AlertDescription>
    </Alert>
  );
}
