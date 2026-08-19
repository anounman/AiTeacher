"use client";

import { AppShell } from "@/components/shell/AppShell";

// App Shell layout — wraps every surface except /print/[id] (which keeps a
// clean, chrome-free print layout). The AppShell provides the Sidebar
// (desktop) / BottomTabBar (mobile), a single Toaster, and the
// SidebarSlotProvider that the chat page portals its conversation list into.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
