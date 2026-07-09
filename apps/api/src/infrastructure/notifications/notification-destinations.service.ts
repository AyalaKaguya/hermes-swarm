import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { NotificationDestination } from "@hermes-swarm/core";

type DestinationPayload = {
  name?: string;
  options?: Record<string, unknown> | null;
  type?: string;
};

type DestinationType = {
  icon?: string;
  name: string;
  schema?: DestinationSchema;
  type: string;
};

type DestinationSchema = {
  properties?: Record<string, DestinationSchemaProperty>;
  required?: string[];
  secret?: string[];
  type?: "object" | string;
};

type DestinationSchemaProperty = {
  maxLength?: number;
  title?: string;
  type?: "string" | string;
};

const DESTINATION_TYPES: DestinationType[] = [
  {
    icon: "dingtalk",
    name: "钉钉",
    schema: {
      properties: {
        password: { maxLength: 512, title: "Password", type: "string" },
        url: { maxLength: 2048, title: "Webhook URL", type: "string" },
        username: { maxLength: 240, title: "Username", type: "string" },
      },
      required: ["url"],
      secret: ["password", "url"],
      type: "object",
    },
    type: "dingtalk",
  },
  {
    icon: "feishu",
    name: "飞书",
    schema: {
      properties: {
        appId: { maxLength: 240, title: "App ID", type: "string" },
        appSecret: { maxLength: 512, title: "App Secret", type: "string" },
        encryptKey: { maxLength: 512, title: "Encrypt Key", type: "string" },
        verificationToken: {
          maxLength: 512,
          title: "Verification Token",
          type: "string",
        },
      },
      required: ["appId", "appSecret"],
      secret: ["appId", "appSecret", "encryptKey", "verificationToken"],
      type: "object",
    },
    type: "feishu",
  },
];
const FEISHU_FETCH_TIMEOUT_MS = 8_000;

@Injectable()
/**
 * notification-destination contract.
 */
export class NotificationDestinationsService {
  constructor(
    @InjectRepository(NotificationDestination)
    private readonly destinationRepository: Repository<NotificationDestination>,
  ) {}

  async list(organizationId: string) {
    const items = await this.destinationRepository.find({
      where: { organizationId: requireText(organizationId, "组织") },
      order: { createdAt: "DESC" },
    });
    return items.map(toDestinationDto);
  }

  async types() {
    return DESTINATION_TYPES;
  }

  async getOne(organizationId: string, destinationId: string) {
    return toDestinationDto(
      await this.getDestinationOrThrow(organizationId, destinationId),
    );
  }

  async create(organizationId: string, input: unknown) {
    const payload = parsePayload(input);
    const destinationType = normalizeType(payload.type);
    const destination = this.destinationRepository.create({
      name: requireText(payload.name, "通知名称", 120),
      options: normalizeOptions(payload.options, destinationType),
      organizationId: requireText(organizationId, "组织"),
      type: destinationType.type,
    });
    return toDestinationDto(await this.destinationRepository.save(destination));
  }

  async update(
    organizationId: string,
    destinationId: string,
    input: unknown,
  ) {
    const payload = parsePayload(input);
    const destination = await this.getDestinationOrThrow(organizationId, destinationId);
    if (payload.name !== undefined) {
      destination.name = requireText(payload.name, "通知名称", 120);
    }
    const nextType =
      payload.type !== undefined
        ? normalizeType(payload.type)
        : getDestinationType(destination.type);
    if (payload.type !== undefined) {
      destination.type = nextType.type;
    }
    if (payload.type !== undefined || payload.options !== undefined) {
      destination.options = normalizeOptions(
        payload.options !== undefined ? payload.options : destination.options,
        nextType,
      );
    }
    return toDestinationDto(await this.destinationRepository.save(destination));
  }

  async delete(organizationId: string, destinationId: string) {
    const destination = await this.getDestinationOrThrow(organizationId, destinationId);
    await this.destinationRepository.remove(destination);
    return { id: destinationId };
  }

  async groups(organizationId: string, destinationId: string) {
    const destination = await this.getDestinationOrThrow(organizationId, destinationId);
    if (destination.type !== "feishu") {
      return [];
    }
    return getFeishuGroups(destination.options ?? {});
  }

  private async getDestinationOrThrow(organizationId: string, destinationId: string) {
    const destination = await this.destinationRepository.findOne({
      where: {
        id: requireText(destinationId, "通知目的地"),
        organizationId: requireText(organizationId, "组织"),
      },
    });
    if (!destination) throw new NotFoundException("通知目的地不存在");
    return destination;
  }
}

async function getFeishuGroups(options: Record<string, unknown>) {
  const appId = typeof options.appId === "string" ? options.appId.trim() : "";
  const appSecret =
    typeof options.appSecret === "string" ? options.appSecret.trim() : "";
  if (!appId || !appSecret) {
    throw new BadRequestException("飞书 App ID 和 App Secret 不能为空");
  }

  const tokenResponse = await fetchFeishu(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/",
    {
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    "获取飞书访问令牌失败",
  );
  const tokenData = tokenResponse.data as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (
    !tokenResponse.response.ok ||
    tokenData.code !== 0 ||
    !tokenData.tenant_access_token
  ) {
    throw new BadRequestException(tokenData.msg || "获取飞书访问令牌失败");
  }

  const groupsResponse = await fetchFeishu(
    "https://open.feishu.cn/open-apis/im/v1/chats",
    {
      headers: {
        Authorization: `Bearer ${tokenData.tenant_access_token}`,
        "Content-Type": "application/json",
      },
    },
    "获取飞书群组失败",
  );
  const groupsData = groupsResponse.data as {
    code?: number;
    data?: { items?: unknown[] };
    msg?: string;
  };
  if (!groupsResponse.response.ok || groupsData.code !== 0) {
    throw new BadRequestException(groupsData.msg || "获取飞书群组失败");
  }
  const items = groupsData.data?.items;
  if (items === undefined) return [];
  if (!Array.isArray(items)) {
    throw new BadRequestException("飞书群组数据格式不正确");
  }
  return items;
}

async function fetchFeishu(
  url: string,
  init: RequestInit,
  fallbackMessage: string,
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(FEISHU_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new BadRequestException(fallbackMessage);
  }

  try {
    return {
      data: await response.json(),
      response,
    };
  } catch {
    throw new BadRequestException(fallbackMessage);
  }
}

function parsePayload(input: unknown): DestinationPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("请求体不能为空");
  }
  return input as DestinationPayload;
}

function normalizeType(value: string | undefined) {
  const type = requireText(value, "通知类型", 80);
  return getDestinationType(type);
}

function getDestinationType(type: string) {
  const destinationType = DESTINATION_TYPES.find((item) => item.type === type);
  if (!destinationType) throw new BadRequestException("通知类型不支持");
  return destinationType;
}

function requireText(value: unknown, label: string, maxLength = 240) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  if (text.length > maxLength) throw new BadRequestException(`${label}过长`);
  return text;
}

function normalizeOptions(
  value: Record<string, unknown> | null | undefined,
  destinationType: DestinationType,
) {
  const schema = destinationType.schema;
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  if (Object.keys(properties).length === 0) {
    return null;
  }

  if (value === undefined || value === null) {
    value = {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("通知配置格式不正确");
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    const rawValue = Reflect.get(value, key);
    const normalizedValue = normalizeOptionValue(rawValue, property, key);
    if (normalizedValue === null) {
      if (required.has(key)) {
        throw new BadRequestException(`${property.title ?? key}不能为空`);
      }
      continue;
    }
    normalized[key] = normalizedValue;
  }
  return normalized;
}

function normalizeOptionValue(
  value: unknown,
  property: DestinationSchemaProperty,
  key: string,
) {
  if (property.type === "string" || property.type === undefined) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string") {
      throw new BadRequestException(`${property.title ?? key}格式不正确`);
    }
    const trimmed = value.trim();
    const maxLength = property.maxLength ?? 2048;
    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${property.title ?? key}过长`);
    }
    return trimmed || null;
  }
  return value ?? null;
}

function toDestinationDto(destination: NotificationDestination) {
  return {
    id: destination.id,
    name: destination.name,
    options: destination.options,
    organizationId: destination.organizationId,
    type: destination.type,
  };
}
