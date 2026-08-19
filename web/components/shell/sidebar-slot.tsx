"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Lets a page render content into the global Sidebar's flex-1 slot (defined in
// `components/shell/Sidebar.tsx`, mounted by `AppShell`) WITHOUT lifting that
// page's state into the layout. The Sidebar attaches `slotRef` to its slot div;
// a page reads `slotEl` and `createPortal`s its content in. `slotEl` is null
// until the Sidebar commits, so callers guard with `{slotEl && createPortal(…)}`
// (also keeps SSR / first-render safe — no portal target yet).
interface SlotCtx {
  slotEl: HTMLElement | null;
  slotRef: (el: HTMLElement | null) => void;
}

const SidebarSlotContext = createContext<SlotCtx | null>(null);

export function SidebarSlotProvider({ children }: { children: React.ReactNode }) {
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const slotRef = useCallback((el: HTMLElement | null) => setSlotEl(el), []);
  return (
    <SidebarSlotContext.Provider value={{ slotEl, slotRef }}>
      {children}
    </SidebarSlotContext.Provider>
  );
}

export function useSidebarSlot(): SlotCtx {
  const ctx = useContext(SidebarSlotContext);
  if (!ctx) throw new Error("useSidebarSlot must be used within a SidebarSlotProvider");
  return ctx;
}