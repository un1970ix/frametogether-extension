import pkg from "../package.json";

const ICON_SIZES = [16, 19, 24, 32, 38, 48, 128];

export function getManifest(target: "chrome" | "firefox") {
  const icons = Object.fromEntries(
    ICON_SIZES.map((s) => [`${s}`, `icons/icon${s}.png`]),
  );

  const base = {
    name: "FrameTogether",
    description: "Sync video playback with friends!",
    version: pkg.version,
    manifest_version: 3,
    permissions: ["storage"],
    host_permissions: ["https://mubi.com/*"],
    content_scripts: [
      {
        matches: ["https://mubi.com/*"],
        js: ["content/index.js"],
        run_at: "document_idle",
      },
    ],
    action: {
      default_popup: "html/popup.html",
      default_icon: icons,
    },
    options_ui: {
      page: "html/options.html",
      open_in_tab: true,
    },
    icons,
  };

  if (target === "chrome") {
    return {
      ...base,
      background: { service_worker: "background/index.js", type: "module" },
    };
  }

  return {
    ...base,
    background: { scripts: ["background/index.js"], type: "module" },
    browser_specific_settings: {
      gecko: {
        id: "{30f2dc41-70a7-41d8-84dd-4696e0bce483}",
        strict_min_version: "115.0",
        data_collection_permissions: {
          required: ["websiteActivity"],
          optional: [],
        },
      },
    },
  };
}
