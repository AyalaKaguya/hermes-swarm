"use client";

import { useEffect, useMemo, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type AvatarUser = {
  displayName?: string | null;
  email?: string | null;
  imageUrl?: string | null;
  username?: string | null;
};

export function UserAvatar({
  className = "",
  size = "md",
  user,
}: {
  className?: string;
  size?: "lg" | "md" | "sm";
  user: AvatarUser | null | undefined;
}) {
  const imageUrl = user?.imageUrl?.trim() || "";
  const [imageFailed, setImageFailed] = useState(false);
  const initials = useMemo(() => getInitials(user), [user]);

  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <Avatar
      aria-label={`${getDisplayName(user)} 头像`}
      className={cn("bg-muted", className)}
      size={size === "md" ? "default" : size}
      title={getDisplayName(user)}
    >
      {imageUrl && !imageFailed ? (
        <AvatarImage
          alt=""
          onError={() => setImageFailed(true)}
          referrerPolicy="no-referrer"
          src={imageUrl}
        />
      ) : (
        <AvatarFallback aria-hidden="true">{initials}</AvatarFallback>
      )}
    </Avatar>
  );
}

function getDisplayName(user: AvatarUser | null | undefined) {
  return user?.displayName || user?.username || user?.email || "用户";
}

function getInitials(user: AvatarUser | null | undefined) {
  const source = getDisplayName(user).trim();
  if (!source) return "U";

  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}
