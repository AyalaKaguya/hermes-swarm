import { Injectable } from "@nestjs/common";
import type {
  CreateUserPayload,
  SearchUsersQuery,
  UpdatePreferredLanguagePayload,
  UpdateUserPasswordPayload,
  UpdateUserPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
export class UsersService {
  constructor(private readonly tenancyService: TenancyService) {}

  async list(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listUsers(context);
  }

  async search(authorization: string | undefined, query: SearchUsersQuery) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.searchUsers(context, query);
  }

  async create(
    authorization: string | undefined,
    payload: CreateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createUser(context, payload);
  }

  async update(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUser(context, userId, payload);
  }

  async updatePassword(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPasswordPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUserPassword(context, userId, payload);
  }

  async updatePreferredLanguage(
    authorization: string | undefined,
    userId: string,
    payload: UpdatePreferredLanguagePayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updatePreferredLanguage(context, userId, payload);
  }
}
