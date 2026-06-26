"use client";

import {
  BarChart3,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  Database,
  FileText,
  Grid2X2,
  Home,
  Layers,
  LogOut,
  Menu,
  MoreVertical,
  PanelLeft,
  Pencil,
  Plug,
  RefreshCw,
  Repeat2,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Users,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type AppIconName =
  | "bell"
  | "bot"
  | "building"
  | "chart"
  | "chevron-down"
  | "database"
  | "file"
  | "grid"
  | "home"
  | "invite"
  | "layers"
  | "logout"
  | "menu"
  | "more"
  | "panel"
  | "pencil"
  | "plug"
  | "refresh"
  | "search"
  | "settings"
  | "sparkles"
  | "switch"
  | "trash"
  | "user"
  | "server"
  | "shield"
  | "users";

const ICONS: Record<AppIconName, LucideIcon> = {
  bell: Bell,
  bot: Bot,
  building: Building2,
  chart: BarChart3,
  "chevron-down": ChevronDown,
  database: Database,
  file: FileText,
  grid: Grid2X2,
  home: Home,
  invite: UserPlus,
  layers: Layers,
  logout: LogOut,
  menu: Menu,
  more: MoreVertical,
  panel: PanelLeft,
  pencil: Pencil,
  plug: Plug,
  refresh: RefreshCw,
  search: Search,
  settings: Settings,
  sparkles: Sparkles,
  switch: Repeat2,
  trash: Trash2,
  user: User,
  server: Server,
  shield: Shield,
  users: Users,
};

export function AppIcon({
  name,
  strokeWidth = 1.8,
  ...props
}: LucideProps & { name: AppIconName }) {
  const Icon = ICONS[name];

  return <Icon aria-hidden="true" strokeWidth={strokeWidth} {...props} />;
}
