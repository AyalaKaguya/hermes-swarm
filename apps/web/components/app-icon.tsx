"use client";

import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bot,
  Building2,
  Check,
  ChevronDown,
  Database,
  ImageUp,
  FileText,
  Grid2X2,
  Home,
  Layers,
  Languages,
  ListX,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreVertical,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Repeat2,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Sparkles,
  Sun,
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
  | "check"
  | "chevron-down"
  | "database"
  | "file"
  | "grid"
  | "home"
  | "image-upload"
  | "invite"
  | "layers"
  | "language"
  | "list-x"
  | "logout"
  | "menu"
  | "moon"
  | "more"
  | "palette"
  | "panel"
  | "pencil"
  | "plus"
  | "plug"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "sparkles"
  | "sun"
  | "system"
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
  check: Check,
  "chevron-down": ChevronDown,
  database: Database,
  file: FileText,
  grid: Grid2X2,
  home: Home,
  "image-upload": ImageUp,
  invite: UserPlus,
  layers: Layers,
  language: Languages,
  "list-x": ListX,
  logout: LogOut,
  menu: Menu,
  moon: Moon,
  more: MoreVertical,
  palette: Palette,
  panel: PanelLeft,
  pencil: Pencil,
  plus: Plus,
  plug: Plug,
  refresh: RefreshCw,
  search: Search,
  send: Send,
  settings: Settings,
  sparkles: Sparkles,
  sun: Sun,
  system: Monitor,
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
