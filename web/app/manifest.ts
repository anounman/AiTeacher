import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StudyGPT — AI Teacher",
    short_name: "StudyGPT",
    description: "A visual, voice-enabled study companion.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f2f0e7",
    theme_color: "#f2f0e7",
    icons: [
      {
        src: "/aiteacher-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
