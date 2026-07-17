import { Controller, Get, Query } from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { AuditQueryService } from "./audit-query.service.js";
import { parseAuditListQuery } from "./audit-query.js";

@Controller("admin/tenant/audit")
@AccessResource({
  entity: "audit",
  entityLabel: "日志审计",
  entityOrder: 90,
  purpose: "tenant_audit",
  purposeLabel: "工作空间审计",
  scope: "tenant",
})
export class TenantAuditController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get("login-logs")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "查看当前工作空间的登录成功和失败记录。",
    label: "查看登录日志",
    operation: "list_login_logs",
    sortOrder: 10,
  })
  listLoginLogs(@Query() query: Record<string, unknown>) {
    return this.auditQueryService.listLoginLogs(
      "tenant",
      parseAuditListQuery(query, { results: ["failed", "success"] }),
    );
  }

  @Get("operation-logs")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "查看当前工作空间及其组织范围内的管理操作。",
    label: "查看操作日志",
    operation: "list_operation_logs",
    sortOrder: 20,
  })
  listOperationLogs(@Query() query: Record<string, unknown>) {
    return this.auditQueryService.listOperationLogs(
      "tenant",
      parseAuditListQuery(query, {
        results: ["allowed", "denied", "error"],
      }),
    );
  }
}

@Controller("admin/platform/audit")
@AccessResource({
  entity: "audit",
  entityLabel: "日志审计",
  entityOrder: 90,
  purpose: "platform_audit",
  purposeLabel: "平台审计",
  scope: "platform",
})
export class PlatformAuditController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get("login-logs")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "查看平台管理员的登录成功和失败记录。",
    label: "查看平台登录日志",
    operation: "list_login_logs",
    sortOrder: 10,
  })
  listLoginLogs(@Query() query: Record<string, unknown>) {
    return this.auditQueryService.listLoginLogs(
      "platform",
      parseAuditListQuery(query, { results: ["failed", "success"] }),
    );
  }

  @Get("operation-logs")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "查看平台管理员执行的平台控制面操作。",
    label: "查看平台操作日志",
    operation: "list_operation_logs",
    sortOrder: 20,
  })
  listOperationLogs(@Query() query: Record<string, unknown>) {
    return this.auditQueryService.listOperationLogs(
      "platform",
      parseAuditListQuery(query, {
        results: ["allowed", "denied", "error"],
      }),
    );
  }
}
