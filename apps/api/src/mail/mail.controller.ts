import { Body, Controller, Get, Headers, Param, Patch, Post, Put } from "@nestjs/common";
import { MailService } from "./mail.service.js";

@Controller("admin/mail")
/**
 * Exposes migrated mail administration endpoints under `/api/admin/mail`.
 */
export class MailController {
  constructor(private readonly mailService: MailService) {}

  /**
   * Returns the effective SMTP configuration without secret values.
   */
  @Get("smtp")
  getSmtp(@Headers("authorization") authorization?: string) {
    return this.mailService.getSmtp(authorization);
  }

  /**
   * Saves custom SMTP settings for the current organization.
   */
  @Put("smtp")
  saveSmtp(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.saveSmtp(authorization, payload);
  }

  /**
   * Validates SMTP configuration fields before persisting or sending mail.
   */
  @Post("smtp/validate")
  validateSmtp(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.validateSmtp(authorization, payload);
  }

  /**
   * Lists global and organization email templates.
   */
  @Get("templates")
  listTemplates(@Headers("authorization") authorization?: string) {
    return this.mailService.listTemplates(authorization);
  }

  /**
   * Creates an organization email template.
   */
  @Post("templates")
  createTemplate(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.createTemplate(authorization, payload);
  }

  /**
   * Updates an existing email template.
   */
  @Patch("templates/:templateId")
  updateTemplate(
    @Headers("authorization") authorization: string | undefined,
    @Param("templateId") templateId: string,
    @Body() payload: any,
  ) {
    return this.mailService.updateTemplate(authorization, templateId, payload);
  }

  /**
   * Lists sent-email log records for the current organization.
   */
  @Get("logs")
  listLogs(@Headers("authorization") authorization?: string) {
    return this.mailService.listLogs(authorization);
  }

  /**
   * Creates a sent-email log record.
   */
  @Post("logs")
  createLog(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.createLog(authorization, payload);
  }
}
