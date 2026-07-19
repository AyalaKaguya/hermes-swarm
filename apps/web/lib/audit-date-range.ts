export type AuditDateBoundary = "end" | "start";

export function auditDateKeyFromDate(date: Date) {
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function auditDateFromKey(value: string) {
  const parts = parseAuditDateKey(value);
  if (!parts) return undefined;
  const date = new Date(parts.year, parts.month - 1, parts.day, 12);
  return date.getFullYear() === parts.year &&
    date.getMonth() === parts.month - 1 &&
    date.getDate() === parts.day
    ? date
    : undefined;
}

export function formatAuditDateKey(value: string, dateFormat: string) {
  const parts = parseAuditDateKey(value);
  if (!parts) return "";
  const year = parts.year.toString().padStart(4, "0");
  const month = parts.month.toString().padStart(2, "0");
  const day = parts.day.toString().padStart(2, "0");
  switch (dateFormat) {
    case "YYYY/MM/DD":
      return `${year}/${month}/${day}`;
    case "MM/DD/YYYY":
      return `${month}/${day}/${year}`;
    case "DD/MM/YYYY":
      return `${day}/${month}/${year}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

export function auditDateBoundaryToIso(
  value: string,
  timeZone: string,
  boundary: AuditDateBoundary,
) {
  const parts = parseAuditDateKey(value);
  if (!parts) return undefined;
  const target = {
    ...parts,
    hour: boundary === "start" ? 0 : 23,
    millisecond: boundary === "start" ? 0 : 999,
    minute: boundary === "start" ? 0 : 59,
    second: boundary === "start" ? 0 : 59,
  };
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    target.millisecond,
  );
  let instant = targetAsUtc;
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const zoned = zonedParts(new Date(instant), timeZone);
      const zonedAsUtc = Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hour,
        zoned.minute,
        zoned.second,
        target.millisecond,
      );
      const adjustment = targetAsUtc - zonedAsUtc;
      instant += adjustment;
      if (!adjustment) break;
    }
  } catch {
    return undefined;
  }
  return new Date(instant).toISOString();
}

function parseAuditDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    month: read("month"),
    second: read("second"),
    year: read("year"),
  };
}
