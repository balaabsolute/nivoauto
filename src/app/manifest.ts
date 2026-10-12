import type { MetadataRoute } from "next";

/** Lets showroom tablets / TVs "Add to Home screen" and launch full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kun Showroom",
    short_name: "Kun",
    start_url: "/kiosk",
    display: "fullscreen",
    orientation: "any",
    background_color: "#0b2f38",
    theme_color: "#0b2f38",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
