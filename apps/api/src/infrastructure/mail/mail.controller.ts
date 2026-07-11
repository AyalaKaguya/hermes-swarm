import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { MailService } from "./mail.service.js";

@Controller("admin/organizations/:organizationId/mail")
@AccessResource({
  entity: "mail",
  entityLabel: "邮件",
  entityOrder: 60,
  purpose: "smtp",
  purposeLabel: "SMTP 配置",
  purposeOrder: 10,
  scope: "organization",
})
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  @AccessOperation({
    description: "查看当前组织的 SMTP 配置。",
    label: "查看 SMTP",
    operation: "view",
    sortOrder: 10,
  })
  @RequireFeature("feature:email:enabled")
  getSmtp(@Param("organizationId") organizationId: string) {
    return this.mailService.getSmtp(organizationId);
  }

  @Put("smtp")
  @AccessOperation({
    description: "保存当前组织的 SMTP 配置。",
    isDangerous: true,
    label: "保存 SMTP",
    operation: "save",
    sortOrder: 20,
  })
  @RequireFeature("feature:email:enabled")
  saveSmtp(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.saveSmtp(organizationId, payload as never);
  }

  @Post("smtp/validate")
  @AccessOperation({
    description: "验证当前组织的 SMTP 配置。",
    label: "验证 SMTP",
    operation: "validate",
    sortOrder: 30,
  })
  @RequireFeature("feature:email:enabled")
  validateSmtp(@Body() payload: unknown) {
    return this.mailService.validateSmtp(payload as never);
  }

  @Get("templates")
  @AccessOperation({
    description: "查看当前组织的邮件模板列表。",
    label: "查看邮件模板",
    operation: "list",
    purpose: "template",
    purposeLabel: "邮件模板",
    purposeOrder: 20,
    sortOrder: 10,
  })
  @RequireFeature("feature:email:enabled")
  listTemplates(@Param("organizationId") organizationId: string) {
    return this.mailService.listTemplates(organizationId);
  }

  @Post("templates")
  @AccessOperation({
    description: "创建当前组织的邮件模板。",
    label: "创建邮件模板",
    operation: "create",
    purpose: "template",
    purposeLabel: "邮件模板",
    purposeOrder: 20,
    sortOrder: 20,
  })
  @RequireFeature("feature:email:enabled")
  createTemplate(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.createTemplate(organizationId, payload as never);
  }

  @Post("templates/preview")
  @AccessOperation({
    description: "使用示例数据预览当前组织的邮件模板。",
    label: "预览邮件模板",
    operation: "preview",
    purpose: "template",
    purposeLabel: "邮件模板",
    purposeOrder: 20,
    sortOrder: 25,
  })
  @RequireFeature("feature:email:enabled")
  previewTemplate(@Body() payload: unknown) {
    return this.mailService.previewTemplate(payload as never);
  }

  @Patch("templates/:templateId")
  @AccessOperation({
    description: "更新当前组织的邮件模板。",
    label: "更新邮件模板",
    operation: "update",
    purpose: "template",
    purposeLabel: "邮件模板",
    purposeOrder: 20,
    sortOrder: 30,
  })
  @RequireFeature("feature:email:enabled")
  updateTemplate(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.updateTemplate(
      organizationId,
      templateId,
      payload as never,
    );
  }

  @Delete("templates/:templateId")
  @AccessOperation({
    description: "删除当前组织的邮件模板。",
    isDangerous: true,
    label: "删除邮件模板",
    operation: "delete",
    purpose: "template",
    purposeLabel: "邮件模板",
    purposeOrder: 20,
    sortOrder: 90,
  })
  @RequireFeature("feature:email:enabled")
  deleteTemplate(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
  ) {
    return this.mailService.deleteTemplate(organizationId, templateId);
  }

  @Get("logs")
  @AccessOperation({
    description: "查看当前组织的邮件日志。",
    label: "查看邮件日志",
    operation: "list_logs",
    purpose: "log",
    purposeLabel: "邮件日志",
    purposeOrder: 30,
    sortOrder: 10,
  })
  @RequireFeature("feature:email:enabled")
  listLogs(@Param("organizationId") organizationId: string) {
    return this.mailService.listLogs(organizationId);
  }

  @Post("logs")
  @AccessOperation({
    description: "创建当前组织的邮件日志。",
    label: "创建邮件日志",
    operation: "create_log",
    purpose: "log",
    purposeLabel: "邮件日志",
    purposeOrder: 30,
    sortOrder: 20,
  })
  @RequireFeature("feature:email:enabled")
  createLog(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.createLog(organizationId, payload as never);
  }
}

@Controller("admin/tenant/mail")
@AccessResource({
  entity: "mail",
  entityLabel: "邮件",
  purpose: "tenant_mail",
  purposeLabel: "租户邮件",
  scope: "tenant",
})
export class TenantMailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  @AccessOperation({ label: "查看租户 SMTP", operation: "view_smtp" })
  getSmtp() { return this.mailService.getTenantSmtp(); }

  @Put("smtp")
  @AccessOperation({ isDangerous: true, label: "保存租户 SMTP", operation: "save_smtp" })
  saveSmtp(@Body() payload: unknown) {
    return this.mailService.saveTenantSmtp(payload as never);
  }

  @Get("templates")
  @AccessOperation({ label: "查看租户邮件模板", operation: "list_templates" })
  listTemplates() { return this.mailService.listTenantTemplates(); }

  @Post("templates")
  @AccessOperation({ label: "创建租户邮件模板", operation: "create_template" })
  createTemplate(@Body() payload: unknown) {
    return this.mailService.createTenantTemplate(payload as never);
  }

  @Patch("templates/:templateId")
  @AccessOperation({ label: "更新租户邮件模板", operation: "update_template" })
  updateTemplate(@Param("templateId") templateId: string, @Body() payload: unknown) {
    return this.mailService.updateTenantTemplate(templateId, payload as never);
  }

  @Delete("templates/:templateId")
  @AccessOperation({ isDangerous: true, label: "删除租户邮件模板", operation: "delete_template" })
  deleteTemplate(@Param("templateId") templateId: string) {
    return this.mailService.deleteTenantTemplate(templateId);
  }
}
