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
  schema?: Record<string, unknown>;
  type: string;
};

const DESTINATION_TYPES: DestinationType[] = [
  {
    icon: "dingtalk",
    name: "钉钉",
    schema: {
      properties: {
        password: { title: "Password", type: "string" },
        url: { title: "Webhook URL", type: "string" },
        username: { title: "Username", type: "string" },
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
        appId: { title: "App ID", type: "string" },
        appSecret: { title: "App Secret", type: "string" },
        encryptKey: { title: "Encrypt Key", type: "string" },
        verificationToken: { title: "Verification Token", type: "string" },
      },
      required: ["appId", "appSecret"],
      secret: ["appId", "appSecret", "encryptKey", "verificationToken"],
      type: "object",
    },
    type: "feishu",
  },
];

@Injectable()
/**
 * Stores and resolves notification destinations following Xpert's analytics
 * notification-destination contract.
 */
export class NotificationDestinationsService {
  constructor(
    @InjectRepository(NotificationDestination)
    private readonly destinationRepository: Repository<NotificationDestination>,
  ) {}

  async list(organizationId: string) {
    const items = await this.destinationRepository.find({
      where: { organizationId },
      order: { createdAt: "DESC" },
    });
    return items.map(toDestinationDto);
  }

  async types() {
    return DESTINATION_TYPES;
  }

  async getOne(organizationId: string, destinationId: string) {
    return toDestinationDto(await this.getDestinationOrThrow(organizationId, destinationId));
  }

  async create(organizationId: string, input: unknown) {
    const payload = parsePayload(input);
    const type = normalizeType(payload.type);
    const destination = this.destinationRepository.create({
      name: requireText(payload.name, "通知名称"),
      options: normalizeOptions(payload.options),
      organizationId,
      type,
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
      destination.name = requireText(payload.name, "通知名称");
    }
    if (payload.type !== undefined) {
      destination.type = normalizeType(payload.type);
    }
    if (payload.options !== undefined) {
      destination.options = normalizeOptions(payload.options);
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
      where: { id: destinationId, organizationId },
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

  const tokenResponse = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/",
    {
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  const tokenData = await tokenResponse.json() as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (!tokenResponse.ok || tokenData.code !== 0 || !tokenData.tenant_access_token) {
    throw new BadRequestException(tokenData.msg || "获取飞书访问令牌失败");
  }

  const groupsResponse = await fetch("https://open.feishu.cn/open-apis/im/v1/chats", {
    headers: {
      Authorization: `Bearer ${tokenData.tenant_access_token}`,
      "Content-Type": "application/json",
    },
  });
  const groupsData = await groupsResponse.json() as {
    code?: number;
    data?: { items?: unknown[] };
    msg?: string;
  };
  if (!groupsResponse.ok || groupsData.code !== 0) {
    throw new BadRequestException(groupsData.msg || "获取飞书群组失败");
  }
  return groupsData.data?.items ?? [];
}

function parsePayload(input: unknown): DestinationPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("请求体不能为空");
  }
  return input as DestinationPayload;
}

function normalizeType(value: string | undefined) {
  const type = requireText(value, "通知类型");
  if (!DESTINATION_TYPES.some((item) => item.type === type)) {
    throw new BadRequestException("通知类型不支持");
  }
  return type;
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptions(value: Record<string, unknown> | null | undefined) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("通知配置格式不正确");
  }
  return value;
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
