import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { Tag } from "@hermes-swarm/core";
import { TenancyService } from "../tenancy/tenancy.service.js";

type TagPayload = {
  category?: string | null;
  color?: string | null;
  description?: string | null;
  icon?: string | null;
  isSystem?: boolean;
  label?: Record<string, unknown> | null;
  name?: string;
};

@Injectable()
/**
 * organization boundary.
 */
export class TagsService {
  constructor(
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    private readonly tenancyService: TenancyService,
  ) {}

  async list(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "tags", "view");
    const tags = await this.tagRepository.find({
      where: [{ organizationId: context.organizationId }, { organizationId: IsNull() }],
      order: { category: "ASC", name: "ASC" },
    });
    return tags.map(toTagDto);
  }

  async listCategories(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "tags", "view");
    const rows = await this.tagRepository
      .createQueryBuilder("tag")
      .select("DISTINCT tag.category", "category")
      .where("(tag.organizationId = :organizationId OR tag.organizationId IS NULL)", {
        organizationId: context.organizationId,
      })
      .andWhere("tag.category IS NOT NULL")
      .orderBy("tag.category", "ASC")
      .getRawMany<{ category: string }>();
    return rows;
  }

  async create(authorization: string | undefined, input: unknown) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "tags", "manage");
    const payload = parseTagPayload(input);
    const name = requireText(payload.name, "标签名称");
    const category = normalizeOptionalText(payload.category);

    await this.assertUnique(context.organizationId, name, category);

    const tag = this.tagRepository.create({
      category,
      color: normalizeOptionalText(payload.color),
      description: normalizeOptionalText(payload.description),
      icon: normalizeOptionalText(payload.icon),
      isSystem: Boolean(payload.isSystem),
      label: normalizeLabel(payload.label),
      name,
      organizationId: context.organizationId,
    });
    return toTagDto(await this.tagRepository.save(tag));
  }

  async update(authorization: string | undefined, tagId: string, input: unknown) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "tags", "manage");
    const tag = await this.getTagOrThrow(context.organizationId, tagId);
    const payload = parseTagPayload(input);
    const nextName = payload.name === undefined ? tag.name : requireText(payload.name, "标签名称");
    const nextCategory =
      payload.category === undefined ? tag.category : normalizeOptionalText(payload.category);

    if (nextName !== tag.name || nextCategory !== tag.category) {
      await this.assertUnique(context.organizationId, nextName, nextCategory, tag.id);
    }

    tag.name = nextName;
    tag.category = nextCategory;
    if (payload.description !== undefined) {
      tag.description = normalizeOptionalText(payload.description);
    }
    if (payload.color !== undefined) {
      tag.color = normalizeOptionalText(payload.color);
    }
    if (payload.icon !== undefined) {
      tag.icon = normalizeOptionalText(payload.icon);
    }
    if (payload.label !== undefined) {
      tag.label = normalizeLabel(payload.label);
    }
    if (payload.isSystem !== undefined) {
      tag.isSystem = Boolean(payload.isSystem);
    }

    return toTagDto(await this.tagRepository.save(tag));
  }

  async delete(authorization: string | undefined, tagId: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "tags", "manage");
    const tag = await this.getTagOrThrow(context.organizationId, tagId);
    await this.tagRepository.remove(tag);
    return { id: tagId };
  }

  private async getTagOrThrow(organizationId: string, tagId: string) {
    const tag = await this.tagRepository.findOne({
      where: { id: tagId, organizationId },
    });
    if (!tag) throw new NotFoundException("标签不存在");
    return tag;
  }

  private async assertUnique(
    organizationId: string,
    name: string,
    category: string | null,
    excludeId?: string,
  ) {
    const existing = await this.tagRepository.findOne({
      where: { category: category ?? IsNull(), name, organizationId },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException("标签已存在");
    }
  }
}

function parseTagPayload(input: unknown): TagPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BadRequestException("请求体不能为空");
  }
  return input as TagPayload;
}

function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeOptionalText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizeLabel(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("标签多语言文本格式不正确");
  }
  return value;
}

function toTagDto(tag: Tag) {
  return {
    category: tag.category,
    color: tag.color,
    description: tag.description,
    icon: tag.icon,
    id: tag.id,
    isSystem: tag.isSystem,
    label: tag.label,
    name: tag.name,
    organizationId: tag.organizationId,
  };
}
