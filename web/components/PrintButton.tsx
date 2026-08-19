"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Triggers the browser's print dialog (→ Save as PDF). `no-print` keeps it
// off the printed page itself.
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => window.print()}
      className="no-print"
    >
      <Printer size={14} />
      print / save as PDF ⌘P
    </Button>
  );
}