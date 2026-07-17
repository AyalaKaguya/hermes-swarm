import type { RuntimePreferences } from "@hermes-swarm/core/settings";

export function runtimeFormattingLocale(preferences: RuntimePreferences) {
  const language = preferences.language;
  const region = preferences.regionCode?.trim();
  return region ? `${language}-${region}` : language;
}

export function formatRuntimeCurrency(
  value: number,
  preferences: RuntimePreferences,
) {
  return new Intl.NumberFormat(runtimeFormattingLocale(preferences), {
    currency: preferences.currency,
    style: "currency",
  }).format(value);
}

export function formatRuntimeDate(
  value: Date | number | string | null | undefined,
  preferences: RuntimePreferences,
) {
  const date = toDate(value);
  if (!date) return "";
  const parts = dateParts(date, preferences);
  switch (preferences.dateFormat) {
    case "YYYY/MM/DD":
      return `${parts.year}/${parts.month}/${parts.day}`;
    case "MM/DD/YYYY":
      return `${parts.month}/${parts.day}/${parts.year}`;
    case "DD/MM/YYYY":
      return `${parts.day}/${parts.month}/${parts.year}`;
    default:
      return `${parts.year}-${parts.month}-${parts.day}`;
  }
}

export function formatRuntimeDateTime(
  value: Date | number | string | null | undefined,
  preferences: RuntimePreferences,
) {
  const date = toDate(value);
  if (!date) return "";
  const time = new Intl.DateTimeFormat(runtimeFormattingLocale(preferences), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: preferences.timeZone,
  }).format(date);
  return `${formatRuntimeDate(date, preferences)} ${time}`;
}

function dateParts(date: Date, preferences: RuntimePreferences) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: preferences.timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { day: value("day"), month: value("month"), year: value("year") };
}

function toDate(value: Date | number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
