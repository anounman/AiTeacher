import type { Metadata, Viewport } from "next";
import { Newsreader, JetBrains_Mono } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";
import { ThemeScript } from "./ThemeScript";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "StudyGPT",
  description: "A local study companion for concept-heavy learning.",
  applicationName: "StudyGPT",
  manifest: "/manifest.webmanifest",
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: "StudyGPT",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/aiteacher-icon.svg",
    apple: "/aiteacher-icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f0e7" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1b1b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // The no-flash theme script (in ThemeScript) sets data-theme on <html>
      // before paint, so the client DOM carries an attribute the server HTML
      // doesn't have. suppressHydrationWarning is the standard fix for this
      // pattern (same approach next-themes uses).
      suppressHydrationWarning
      className={`${newsreader.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        {/* Keep the legacy Apple flag alongside the standards-based manifest;
            older iPadOS versions still key Home-Screen standalone mode off it. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/* Icon font for the teach-stage overlay chrome. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=swap"
        />
        {/* Caveat — the handwriting font for the teach board. The mathwriter
            sidecar emits <text font-family="'Caveat'"> in font_mode; the
            browser renders these with this font. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="flex h-full min-h-full flex-col overflow-hidden bg-paper text-ink">
        {/* Emits the theme-init script into the SSR stream via
            useServerInsertedHTML, outside React's client tree, so it runs
            before paint (no flash) and React 19 never warns about a <script>
            rendered on the client. */}
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
