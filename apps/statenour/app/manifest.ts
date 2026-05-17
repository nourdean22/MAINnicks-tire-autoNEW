import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "STATENOUR",
    short_name: "STATENOUR",
    description: "Shadow-tactical operator OS for command, recovery, capture, and system control.",
    start_url: "/",
    display: "standalone",
    background_color: "#07090e",
    theme_color: "#07090e",
    orientation: "portrait",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
    shortcuts: [
      { name: "HQ",      short_name: "HQ",      url: "/" },
      { name: "Chat",    short_name: "Chat",    url: "/chat" },
      { name: "Journal", short_name: "Journal", url: "/journal" },
      { name: "Health",  short_name: "Health",  url: "/system/health" },
    ],
  };
}
