import type { User } from "@hermes-swarm/core";

export function toUserDto(user: User) {
  return {
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName,
    id: user.id,
    imageUrl: user.imageUrl,
    lastName: user.lastName,
    mobile: user.mobile,
    nickname: user.nickname,
    preferredLanguage: user.preferredLanguage,
    status: user.status,
    timeZone: user.timeZone,
    type: user.type,
    updatedAt: user.updatedAt,
    username: user.username,
  };
}
