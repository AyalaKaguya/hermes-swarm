"use client";

import type { SVGProps } from "react";

export type AppIconName =
  | "bell"
  | "bot"
  | "building"
  | "chart"
  | "chevron-down"
  | "database"
  | "grid"
  | "invite"
  | "layers"
  | "logout"
  | "menu"
  | "panel"
  | "plug"
  | "refresh"
  | "search"
  | "settings"
  | "sparkles"
  | "switch"
  | "trash"
  | "user"
  | "users";

export function AppIcon({
  className = "",
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: AppIconName }) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  return (
    <svg className={className} {...common} {...props}>
      {name === "bell" && (
        <path d="M15 17H9m6 0a3 3 0 0 1-6 0m6 0h3l-1.1-1.1A2 2 0 0 1 15 14.5V11a3 3 0 0 0-6 0v3.5a2 2 0 0 1-.9 1.7L7 17h3" />
      )}
      {name === "bot" && (
        <>
          <rect x="6" y="8" width="12" height="10" rx="3" />
          <path d="M9 5.5 10.5 8M15 5.5 13.5 8M9 13h.01M15 13h.01" />
        </>
      )}
      {name === "building" && (
        <>
          <path d="M4 20h16" />
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="M10 8h.01M14 8h.01M10 12h.01M14 12h.01M10 16h.01M14 16h.01" />
        </>
      )}
      {name === "chart" && (
        <>
          <path d="M4 19h16" />
          <path d="M7 17V10M12 17V6M17 17v-8" />
        </>
      )}
      {name === "chevron-down" && <path d="m6 9 6 6 6-6" />}
      {name === "database" && (
        <>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
        </>
      )}
      {name === "grid" && (
        <>
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </>
      )}
      {name === "invite" && (
        <>
          <circle cx="9" cy="9" r="3" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <path d="M17 8v6M14 11h6" />
        </>
      )}
      {name === "layers" && (
        <>
          <path d="M12 4 4 8l8 4 8-4-8-4Z" />
          <path d="M4 12l8 4 8-4M4 16l8 4 8-4" />
        </>
      )}
      {name === "logout" && (
        <>
          <path d="M10 17H7a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3h3" />
          <path d="m14 8 4 4-4 4M18 12H10" />
        </>
      )}
      {name === "menu" && (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
      {name === "panel" && (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M8 5v14M4 9h16" />
        </>
      )}
      {name === "plug" && (
        <>
          <path d="M8 12V9m8 3V9" />
          <path d="M7 12h10v2a5 5 0 0 1-5 5h0a5 5 0 0 1-5-5v-2Z" />
          <path d="M10 5v4m4-4v4" />
        </>
      )}
      {name === "refresh" && (
        <>
          <path d="M20 12a8 8 0 0 1-13.7 5.6" />
          <path d="M4 12A8 8 0 0 1 17.7 6.4" />
          <path d="M7 18H4v-3M17 6h3v3" />
        </>
      )}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="5.5" />
          <path d="m16 16 4 4" />
        </>
      )}
      {name === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.96l.08.08-1.7 2.95-.11-.03a1.8 1.8 0 0 0-2.17.87l-.05.1h-3.4l-.05-.1a1.8 1.8 0 0 0-2.17-.87l-.11.03-1.7-2.95.08-.08A1.8 1.8 0 0 0 4.6 15l-.03-.11v-3.4l.1-.05a1.8 1.8 0 0 0 .87-2.17l-.03-.11 1.7-2.95.11.03a1.8 1.8 0 0 0 2.17-.87l.05-.1h3.4l.05.1a1.8 1.8 0 0 0 2.17.87l.11-.03 1.7 2.95-.08.08a1.8 1.8 0 0 0-.36 1.96l.03.11v3.4Z" />
        </>
      )}
      {name === "sparkles" && (
        <>
          <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
          <path d="M19 14l.8 2.1L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.9L19 14Z" />
        </>
      )}
      {name === "switch" && (
        <>
          <rect x="4" y="7" width="16" height="10" rx="5" />
          <circle cx="9" cy="12" r="2.8" />
        </>
      )}
      {name === "trash" && (
        <>
          <path d="M4 7h16M10 11v6M14 11v6" />
          <path d="M9 7V5h6v2M6 7l1 13h10l1-13" />
        </>
      )}
      {name === "user" && (
        <>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </>
      )}
      {name === "users" && (
        <>
          <circle cx="9" cy="8" r="2.5" />
          <path d="M4 19a5 5 0 0 1 10 0" />
          <circle cx="17" cy="9" r="2" />
          <path d="M14.5 19a4.5 4.5 0 0 1 7.5 0" />
        </>
      )}
    </svg>
  );
}
