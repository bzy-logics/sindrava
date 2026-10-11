import type { AxisConfig, McuConfig, RobotConfig } from "../../types/api";

export interface McuGroup {
  mcu: McuConfig | null;
  name: string;
  axes: AxisConfig[];
}

/** Robot -> MCU -> channels (sorted) -> axis. Axes referencing an unknown MCU get their own group. */
export function buildDeviceGraph(config: RobotConfig): McuGroup[] {
  const groups: McuGroup[] = config.mcus.map((m) => ({ mcu: m, name: m.name, axes: [] }));
  for (const a of config.axes) {
    let g = groups.find((x) => x.name === a.mcu);
    if (!g) groups.push((g = { mcu: null, name: a.mcu, axes: [] }));
    g.axes.push(a);
  }
  for (const g of groups) g.axes.sort((x, y) => x.mcu_channel - y.mcu_channel);
  return groups;
}
