import pkg from "../package.json";

export function getManifest(target: "chrome" | "firefox") {
  const sizes = [16, 19, 24, 32, 38, 48, 128];
  const iconSizes = Object.fromEntries(
    sizes.map((s) => [`${s}`, `icons/icon${s}.png`]),
  );

  const baseManifest = {
    name: "FrameTogether",
    description: "Sync video playback with friends!",
    version: pkg.version,
    permissions: ["storage", "tabs"],
    content_scripts: [
      {
        matches: ["https://mubi.com/*"],
        js: ["content/index.js"],
        run_at: "document_idle",
      },
    ],
    options_ui: {
      page: "html/options.html",
      open_in_tab: true,
    },
    icons: iconSizes,
  };

  return target === "chrome"
    ? {
        ...baseManifest,
        manifest_version: 3,
        host_permissions: ["https://mubi.com/*"],
        background: {
          service_worker: "background/index.js",
          type: "module",
        },
        action: {
          default_popup: "html/popup.html",
          default_icon: iconSizes,
        },
      }
    : {
        ...baseManifest,
        manifest_version: 2,
        permissions: [...baseManifest.permissions, "https://mubi.com/*"],
        background: {
          scripts: ["background/index.js"],
          persistent: false,
        },
        browser_action: {
          default_popup: "html/popup.html",
          default_icon: iconSizes,
        },
        browser_specific_settings: {
          gecko: {
            id: "{30f2dc41-70a7-41d8-84dd-4696e0bce483}",
            strict_min_version: "109.0.1",
          },
        },
      };
}
