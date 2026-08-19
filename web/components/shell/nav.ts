import {
  MessageSquare,
  Layers,
  Network,
  FolderKanban,
  Settings,
  type LucideIcon,
} from "lucide-react";

// Single source of truth for app navigation. Shared by the desktop Sidebar and
// the mobile BottomTabBar. Chat is included here (it was not in the old Sidebar
// NAV because chat was the home — now the sidebar is global, so every surface is
// one tap away).
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Match strategy: "exact" (only `/`) or "prefix" (path === href || starts with href + "/").
  match: "exact" | "prefix";
  // Primary items (Chat, Settings) sit at full weight. Secondary items
  // (Decks, Map, Projects) are study/library surfaces — kept reachable but
  // grouped under a "Library" heading on desktop so the app reads as a chat
  // app first, not a study platform.
  secondary?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Chat", icon: MessageSquare, match: "exact" },
  { href: "/decks", label: "Decks", icon: Layers, match: "prefix", secondary: true },
  // "Map" is the concept graph route (/graph) — it also hosts the per-concept
  // mastery list (toggle), so the old standalone /mastery + /review routes
  // redirect here / into /decks. Route path stays "/graph" to avoid churning
  // inbound links; only the label/icon changed.
  { href: "/graph", label: "Map", icon: Network, match: "prefix", secondary: true },
  { href: "/projects", label: "Projects", icon: FolderKanban, match: "prefix", secondary: true },
  { href: "/settings", label: "Settings", icon: Settings, match: "prefix" },
];

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}