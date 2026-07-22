import { BadRequestException } from "@nestjs/common";

export type AuditListQuery = {
  actorId: string | null;
  from: Date | null;
  httpMethod: string | null;
  keyword: string | null;
  page: number;
  pageSize: number;
  permission: string | null;
  result: string | null;
  to: Date | null;
};

export function parseAuditListQuery(
  value: Record<string, unknown> | undefined,
  options: { results: readonly string[] },
): AuditListQuery {
  const page = parseInteger(value?.page, "page", 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = parseInteger(value?.pageSize, "pageSize", 20, 1, 100);
  const from = parseDate(value?.from, "from");
  const to = parseDate(value?.to, "to");
  if (from && to && from.getTime() > to.getTime()) {
    throw new BadRequestException("开始时间不能晚于结束时间");
  }
  const result = parseOptionalText(value?.result, "result", 24);
  if (result && !options.results.includes(result)) {
    throw new BadRequestException("日志结果筛选值无效");
  }
  const actorId = parseOptionalText(value?.actorId, "actorId", 36);
  if (actorId && !isUuid(actorId)) {
    throw new BadRequestException("actorId 格式无效");
  }
  const httpMethod = parseOptionalText(value?.httpMethod, "httpMethod", 16);
  if (httpMethod && !/^[A-Za-z]+$/.test(httpMethod)) {
    throw new BadRequestException("HTTP 方法格式无效");
  }
  return {
    actorId,
    from,
    httpMethod: httpMethod?.toUpperCase() ?? null,
    keyword: parseOptionalText(value?.keyword, "keyword", 160),
    page,
    pageSize,
    permission: parseOptionalText(value?.permission, "permission", 220),
    result,
    to,
  };
}

function parseInteger(
  value: unknown,
  label: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new BadRequestException(`${label} 必须是整数`);
    }
    if (value < minimum || value > maximum) {
      throw new BadRequestException(
        `${label} 必须介于 ${minimum} 和 ${maximum} 之间`,
      );
    }
    return value;
  }
  const text = readSingleValue(value, label);
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException(`${label} 必须是整数`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(
      `${label} 必须介于 ${minimum} 和 ${maximum} 之间`,
    );
  }
  return parsed;
}

function parseDate(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return null;
  const text = readSingleValue(value, label);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(`${label} 必须是有效的 ISO 时间`);
  }
  return parsed;
}

function parseOptionalText(value: unknown, label: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = readSingleValue(value, label).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new BadRequestException(`${label} 长度不能超过 ${maxLength}`);
  }
  return normalized;
}

function readSingleValue(value: unknown, label: string) {
  if (Array.isArray(value) || typeof value !== "string") {
    throw new BadRequestException(`${label} 格式无效`);
  }
  return value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
