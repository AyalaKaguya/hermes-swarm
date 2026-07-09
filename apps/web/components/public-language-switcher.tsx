"use client";

import { useTranslations } from "next-intl";
import { AppIcon } from "@/components/app-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/components/i18n-provider";
import { LANGUAGE_OPTIONS, getLanguageLabel } from "@/lib/i18n";

export function PublicLanguageSwitcher() {
  const t = useTranslations("language");
  const { language, setLanguage } = useI18n();
  const currentLabel = getLanguageLabel(language);

  return (
    <div className="absolute right-4 top-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("switchLanguage")}
            className="h-8 gap-2 px-2 text-xs"
            size="sm"
            type="button"
            variant="ghost"
          >
            <AppIcon className="size-4" name="language" />
            <span>{currentLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {LANGUAGE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              onClick={() => setLanguage(option.value)}
            >
              <span>{option.label}</span>
              {option.value === language && (
                <AppIcon className="ml-auto size-4" name="check" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
