import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { MailService } from "./mail.service.js";

@Controller("admin/organizations/:organizationId/mail")
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  @RequirePermission({ action: "read", entity: "mail", scope: "organization" })
  getSmtp(@Param("organizationId") organizationId: string) {
    return this.mailService.getSmtp(organizationId);
  }

  @Put("smtp")
  @RequirePermission({ action: "update", entity: "mail", scope: "organization" })
  saveSmtp(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.saveSmtp(organizationId, payload as never);
  }

  @Post("smtp/validate")
  @RequirePermission({ action: "update", entity: "mail", scope: "organization" })
  validateSmtp(@Body() payload: unknown) {
    return this.mailService.validateSmtp(payload as never);
  }

  @Get("templates")
  @RequirePermission({ action: "read", entity: "mail", scope: "organization" })
  listTemplates(@Param("organizationId") organizationId: string) {
    return this.mailService.listTemplates(organizationId);
  }

  @Post("templates")
  @RequirePermission({ action: "create", entity: "mail", scope: "organization" })
  createTemplate(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.createTemplate(organizationId, payload as never);
  }

  @Patch("templates/:templateId")
  @RequirePermission({ action: "update", entity: "mail", scope: "organization" })
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
  @RequirePermission({ action: "delete", entity: "mail", scope: "organization" })
  deleteTemplate(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
  ) {
    return this.mailService.deleteTemplate(organizationId, templateId);
  }

  @Get("logs")
  @RequirePermission({ action: "read", entity: "mail", scope: "organization" })
  listLogs(@Param("organizationId") organizationId: string) {
    return this.mailService.listLogs(organizationId);
  }

  @Post("logs")
  @RequirePermission({ action: "create", entity: "mail", scope: "organization" })
  createLog(
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.mailService.createLog(organizationId, payload as never);
  }
}
