import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { MailService } from "./mail.service.js";

@Controller("admin/platform/mail")
@AccessResource({
  entity: "mail",
  entityLabel: "邮件",
  entityOrder: 60,
  purpose: "platform_template",
  purposeLabel: "平台邮件模板",
  purposeOrder: 25,
  scope: "platform",
})
export class PlatformMailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  @AccessOperation({
    description: "查看平台公共 SMTP 配置。",
    label: "查看公共 SMTP",
    operation: "view",
    purpose: "platform_smtp",
    purposeLabel: "公共 SMTP",
    purposeOrder: 15,
    sortOrder: 10,
  })
  getSmtp() {
    return this.mailService.getPlatformSmtp();
  }

  @Post("smtp/validate")
  @AccessOperation({
    description: "验证平台公共 SMTP 配置。",
    label: "验证公共 SMTP",
    operation: "validate",
    purpose: "platform_smtp",
    purposeLabel: "公共 SMTP",
    purposeOrder: 15,
    sortOrder: 20,
  })
  validateSmtp(@Body() payload: unknown) {
    return this.mailService.validateSmtp(payload as never);
  }

  @Patch("smtp")
  @AccessOperation({
    description: "保存平台公共 SMTP 配置。",
    isDangerous: true,
    label: "保存公共 SMTP",
    operation: "save",
    purpose: "platform_smtp",
    purposeLabel: "公共 SMTP",
    purposeOrder: 15,
    sortOrder: 30,
  })
  saveSmtp(@Body() payload: unknown) {
    return this.mailService.savePlatformSmtp(payload as never);
  }

  @Get("templates")
  @AccessOperation({
    description: "查看平台邮件模板列表。",
    label: "查看平台邮件模板",
    operation: "list",
    sortOrder: 10,
  })
  listTemplates() {
    return this.mailService.listTemplates(null);
  }

  @Post("templates")
  @AccessOperation({
    description: "创建平台邮件模板。",
    label: "创建平台邮件模板",
    operation: "create",
    sortOrder: 20,
  })
  createTemplate(@Body() payload: unknown) {
    return this.mailService.createTemplate(null, payload as never);
  }

  @Post("templates/preview")
  @AccessOperation({
    description: "使用示例数据预览平台邮件模板。",
    label: "预览平台邮件模板",
    operation: "preview",
    sortOrder: 25,
  })
  previewTemplate(@Body() payload: unknown) {
    return this.mailService.previewTemplate(payload as never);
  }

  @Patch("templates/:templateId")
  @AccessOperation({
    description: "更新平台邮件模板。",
    label: "更新平台邮件模板",
    operation: "update",
    sortOrder: 30,
  })
  updateTemplate(
    @Param("templateId") templateId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.updateTemplate(null, templateId, payload as never);
  }

  @Delete("templates/:templateId")
  @AccessOperation({
    description: "删除平台邮件模板。",
    isDangerous: true,
    label: "删除平台邮件模板",
    operation: "delete",
    sortOrder: 90,
  })
  deleteTemplate(@Param("templateId") templateId: string) {
    return this.mailService.deleteTemplate(null, templateId);
  }
}
