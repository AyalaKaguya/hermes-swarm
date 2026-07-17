import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { MailService } from "./mail.service.js";

@Controller("admin/tenant/mail")
@AccessResource({
  entity: "mail",
  entityLabel: "邮件",
  entityOrder: 60,
  purpose: "tenant_mail",
  purposeLabel: "工作空间邮件",
  scope: "tenant",
})
export class TenantMailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  @AccessOperation({ label: "查看工作空间 SMTP", operation: "view_smtp" })
  @RequireFeature("feature:email:enabled")
  getSmtp() {
    return this.mailService.getTenantSmtp();
  }

  @Put("smtp")
  @AccessOperation({ isDangerous: true, label: "保存工作空间 SMTP", operation: "save_smtp" })
  @RequireFeature("feature:email:enabled")
  saveSmtp(@Body() payload: unknown) {
    return this.mailService.saveTenantSmtp(payload as never);
  }

  @Post("smtp/validate")
  @AccessOperation({ label: "验证工作空间 SMTP", operation: "validate_smtp" })
  @RequireFeature("feature:email:enabled")
  validateSmtp(@Body() payload: unknown) {
    return this.mailService.validateSmtp(payload as never);
  }

  @Get("templates")
  @AccessOperation({ label: "查看工作空间邮件模板", operation: "list_templates" })
  @RequireFeature("feature:email:enabled")
  listTemplates() {
    return this.mailService.listTenantTemplates();
  }

  @Post("templates")
  @AccessOperation({ label: "创建工作空间邮件模板", operation: "create_template" })
  @RequireFeature("feature:email:enabled")
  createTemplate(@Body() payload: unknown) {
    return this.mailService.createTenantTemplate(payload as never);
  }

  @Post("templates/preview")
  @AccessOperation({ label: "预览工作空间邮件模板", operation: "preview_template" })
  @RequireFeature("feature:email:enabled")
  previewTemplate(@Body() payload: unknown) {
    return this.mailService.previewTemplate(payload as never);
  }

  @Patch("templates/:templateId")
  @AccessOperation({ label: "更新工作空间邮件模板", operation: "update_template" })
  @RequireFeature("feature:email:enabled")
  updateTemplate(@Param("templateId") templateId: string, @Body() payload: unknown) {
    return this.mailService.updateTenantTemplate(templateId, payload as never);
  }

  @Delete("templates/:templateId")
  @AccessOperation({ isDangerous: true, label: "删除工作空间邮件模板", operation: "delete_template" })
  @RequireFeature("feature:email:enabled")
  deleteTemplate(@Param("templateId") templateId: string) {
    return this.mailService.deleteTenantTemplate(templateId);
  }

  @Get("logs")
  @AccessOperation({ label: "查看工作空间邮件日志", operation: "list_logs" })
  @RequireFeature("feature:email:enabled")
  listLogs() {
    return this.mailService.listLogs();
  }
}
