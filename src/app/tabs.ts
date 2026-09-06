export const TABS = [
  { id: "dashboard", label: "Overview" },
  { id: "motion", label: "Motion" },
  { id: "viewer", label: "3D Viewer" },
  { id: "robot", label: "Robot" },
  { id: "composer", label: "Composer" },
  { id: "firmware", label: "Firmware" },
  { id: "plugins", label: "Plugins" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "settings", label: "Settings" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** Old hash names keep working after the restructure. */
const ALIASES: Record<string, TabId> = { control: "motion", config: "robot", configuration: "robot" };

export function tabFromHash(hash: string): TabId {
  const h = hash.replace(/^#/, "");
  return TABS.find((t) => t.id === h)?.id ?? ALIASES[h] ?? "dashboard";
}
