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
/**
 * Implements migrated user-management operations on top of the shared tenancy
 * service so route ownership is split without duplicating auth logic.
 */
export class UsersService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Lists users in the active organization after checking user view permission.
   */
  async list(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listUsers(context);
  }

  /**
   * Searches organization users by profile, email, username, or mobile fields.
   */
  async search(authorization: string | undefined, query: SearchUsersQuery) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.searchUsers(context, query);
  }

  /**
   * Creates a user in the active organization with the requested role.
   */
  async create(
    authorization: string | undefined,
    payload: CreateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.createUser(context, payload);
  }

  /**
   * Updates mutable profile, status, role, and credential fields for a user.
   */
  async update(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUser(context, userId, payload);
  }

  /**
   * Updates a user password, allowing self-service with current password proof.
   */
  async updatePassword(
    authorization: string | undefined,
    userId: string,
    payload: UpdateUserPasswordPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updateUserPassword(context, userId, payload);
  }

  /**
   * Updates a user's preferred language within the supported language set.
   */
  async updatePreferredLanguage(
    authorization: string | undefined,
    userId: string,
    payload: UpdatePreferredLanguagePayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.updatePreferredLanguage(context, userId, payload);
  }
}
