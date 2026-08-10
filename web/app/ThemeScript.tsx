"use client";

import { useServerInsertedHTML } from "next/navigation";

// No-flash theme init, injected OUTSIDE React's client component tree via
// useServerInsertedHTML. The callback's HTML is emitted into the server
// response stream (Next places useServerInsertedHTML output in <head>), so the
// inline script runs during head parse — before the body paints — applying
// the stored theme with no flash. Because this content is never part of the
// client hydration tree, React 19 never renders a <script> on the client and
// the "Encountered a script tag while rendering React component" warning does
// not fire (unlike a raw <script> or next/script, which React does see).
const THEME_INIT = `(function(){try{var t=localStorage.getItem('studygpt-theme');if(t!=='dark')t='light';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;

export function ThemeScript() {
  useServerInsertedHTML(() => {
    return <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />;
  });
  return null;
}