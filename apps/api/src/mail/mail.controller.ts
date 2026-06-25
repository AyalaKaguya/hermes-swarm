import { Body, Controller, Get, Headers, Param, Patch, Post, Put } from "@nestjs/common";
import { MailService } from "./mail.service.js";

@Controller("admin/mail")
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get("smtp")
  getSmtp(@Headers("authorization") authorization?: string) {
    return this.mailService.getSmtp(authorization);
  }

  @Put("smtp")
  saveSmtp(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.saveSmtp(authorization, payload);
  }

  @Post("smtp/validate")
  validateSmtp(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.validateSmtp(authorization, payload);
  }

  @Get("templates")
  listTemplates(@Headers("authorization") authorization?: string) {
    return this.mailService.listTemplates(authorization);
  }

  @Post("templates")
  createTemplate(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.createTemplate(authorization, payload);
  }

  @Patch("templates/:templateId")
  updateTemplate(
    @Headers("authorization") authorization: string | undefined,
    @Param("templateId") templateId: string,
    @Body() payload: any,
  ) {
    return this.mailService.updateTemplate(authorization, templateId, payload);
  }

  @Get("logs")
  listLogs(@Headers("authorization") authorization?: string) {
    return this.mailService.listLogs(authorization);
  }

  @Post("logs")
  createLog(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: any,
  ) {
    return this.mailService.createLog(authorization, payload);
  }
}
