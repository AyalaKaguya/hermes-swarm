import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { TagsService } from "./tags.service.js";

@Controller("admin/tags")
/**
 * Organization tag endpoints migrated from Xpert's tag module.
 */
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(@Headers("authorization") authorization?: string) {
    return this.tagsService.list(authorization);
  }

  @Get("categories")
  categories(@Headers("authorization") authorization?: string) {
    return this.tagsService.listCategories(authorization);
  }

  @Post()
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.tagsService.create(authorization, payload);
  }

  @Patch(":tagId")
  update(
    @Headers("authorization") authorization: string | undefined,
    @Param("tagId") tagId: string,
    @Body() payload: unknown,
  ) {
    return this.tagsService.update(authorization, tagId, payload);
  }

  @Delete(":tagId")
  delete(
    @Headers("authorization") authorization: string | undefined,
    @Param("tagId") tagId: string,
  ) {
    return this.tagsService.delete(authorization, tagId);
  }
}
