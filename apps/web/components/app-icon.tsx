"use client";

import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  Database,
  ImageUp,
  FileText,
  Grid2X2,
  Home,
  Layers,
  ListX,
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
  Upload,
  User,
  UserPlus,
  Users,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

export type AppIconName =
  | "arrow-left"
  | "bell"
  | "bot"
  | "building"
  | "chart"
  | "chevron-down"
  | "database"
  | "file"
  | "grid"
  | "home"
  | "image-upload"
  | "invite"
  | "layers"
  | "list-x"
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
  | "upload"
  | "user"
  | "server"
  | "shield"
  | "users"
  | "x";

const ICONS: Record<AppIconName, LucideIcon> = {
  "arrow-left": ArrowLeft,
  bell: Bell,
  bot: Bot,
  building: Building2,
  chart: BarChart3,
  "chevron-down": ChevronDown,
  database: Database,
  file: FileText,
  grid: Grid2X2,
  home: Home,
  "image-upload": ImageUp,
  invite: UserPlus,
  layers: Layers,
  "list-x": ListX,
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
  upload: Upload,
  user: User,
  server: Server,
  shield: Shield,
  users: Users,
  x: X,
};

export function AppIcon({
  name,
  strokeWidth = 1.8,
  ...props
}: LucideProps & { name: AppIconName }) {
  const Icon = ICONS[name];

  return <Icon aria-hidden="true" strokeWidth={strokeWidth} {...props} />;
}
