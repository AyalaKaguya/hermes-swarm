import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import { In, Repository } from "typeorm";
import { SettingsService } from "../settings/settings.service.js";

export type WorkspaceLoginResolutionSource = "host" | "workspace";

export type WorkspaceLoginResolution = {
  source: WorkspaceLoginResolutionSource;
  workspace: Workspace;
};

@Injectable()
export class WorkspaceLoginResolverService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly settings: SettingsService,
  ) {}

  async resolve(
    request: unknown,
    workspace?: unknown,
  ): Promise<WorkspaceLoginResolution | null> {
    const explicitIdentifier = normalizeWorkspace(workspace);
    const hostCandidate = await this.resolveHostCandidate(request);
    const [hostWorkspace, explicitWorkspace] = await Promise.all([
      hostCandidate ? this.findAvailableWorkspace(hostCandidate) : Promise.resolve(null),
      explicitIdentifier
        ? this.findAvailableWorkspace(explicitIdentifier)
        : Promise.resolve(null),
    ]);

    if (hostCandidate && !hostWorkspace && explicitWorkspace) {
      throw new BadRequestException("工作空间与当前地址不匹配");
    }
    if (hostWorkspace && explicitWorkspace && hostWorkspace.id !== explicitWorkspace.id) {
      throw new BadRequestException("工作空间与当前地址不匹配");
    }
    if (hostWorkspace) return { source: "host", workspace: hostWorkspace };
    if (explicitWorkspace) return { source: "workspace", workspace: explicitWorkspace };
    return null;
  }

  toPublicContext(resolution: WorkspaceLoginResolution | null) {
    return resolution
      ? {
          source: resolution.source,
          workspace: {
            name: resolution.workspace.name,
            slug: resolution.workspace.slug,
          },
        }
      : { source: null, workspace: null };
  }

  private async resolveHostCandidate(request: unknown) {
    const enabled = await this.settings.getPlatformValue(
      PLATFORM_SETTING_KEYS.subdomainRoutingEnabled,
      "false",
    );
    if (enabled !== "true") return null;
    const rootDomain = normalizeHostname(
      await this.settings.getPlatformValue(
        PLATFORM_SETTING_KEYS.rootDomain,
        "localhost",
      ),
    );
    const hostname = normalizeHostname(getOriginalHost(request));
    if (!rootDomain || !hostname || hostname === rootDomain) return null;
    if (hostname === "localhost" || isIpAddress(hostname)) return null;
    if (!hostname.endsWith(`.${rootDomain}`)) return null;
    const prefix = hostname.slice(0, -(rootDomain.length + 1));
    return normalizeWorkspace(prefix.split(".").filter(Boolean).at(-1));
  }

  private findAvailableWorkspace(identifier: string) {
    return this.workspaces.findOne({
      where: [
        { slug: identifier, status: In(["active", "provisioning"]) },
        { status: In(["active", "provisioning"]), subdomain: identifier },
      ],
    });
  }
}

function getOriginalHost(request: unknown) {
  const headers = (request as { headers?: Record<string, unknown> } | null)?.headers;
  return firstHeaderValue(headers?.["x-forwarded-host"]) ?? firstHeaderValue(headers?.host);
}

function firstHeaderValue(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.split(",")[0]?.trim() ?? null : null;
}

function normalizeHostname(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase().replace(/\.$/, "");
  if (!text) return null;
  if (text.startsWith("[")) return text.slice(1, text.indexOf("]"));
  return text.split(":")[0] || null;
}

function normalizeWorkspace(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
    ? normalized
    : null;
}

function isIpAddress(hostname: string) {
  return /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(":");
}
