// Contract types for the ratavyr REST/WebSocket API v1.
// Mirrors ratavyr/docs/rest-api.md exactly: snake_case keys,
// lowercase enums, unset optionals are `null` (never omitted).

/** Keeps a string union open-ended so unknown future values still render. */
export type Open<T extends string> = T | (string & {});

// ---------------------------------------------------------------- health / info

/** GET /api/health (never requires auth). */
export interface Health {
  status: Open<"ok">;
  engine: { connected: boolean };
}

export interface EngineInfo {
  api_version: string;
  engine_version: string;
  mcu_protocol_version: number;
  plugin_api_version: string;
  fault_injection_enabled: boolean;
}

/** GET /api/info (never requires auth). */
export interface ServerInfo {
  server_version: string;
  auth_required: boolean;
  engine: EngineInfo | null;
}

// ---------------------------------------------------------------- telemetry

export type RobotState =
  | "disconnected"
  | "initializing"
  | "disabled"
  | "ready"
  | "homing"
  | "running"
  | "faulted"
  | "emergency_stopped";

export type FaultCode =
  | "communication_lost"
  | "queue_underrun"
  | "segment_late"
  | "limit_hit"
  | "soft_limit"
  | "homing_failed"
  | "mcu_fault"
  | "plugin_failed"
  | "emergency_stop";

export interface Fault {
  code: Open<FaultCode>;
  message: string;
  axis: string | null;
}

/** MCU link status. String fields are "" until the MCU has identified itself. */
export interface McuStatus {
  connected: boolean;
  transport: string;
  target: string;
  board: string;
  firmware_version: string;
  protocol_version: number;
  build_hash: string;
  capabilities: string[];
  queue_capacity: number;
  queue_depth: number;
  clock_offset_us: number;
  rtt_us: number;
  tx_frames: number;
  rx_frames: number;
  crc_errors: number;
  last_heartbeat_ms_ago: number | null;
}

export interface AxisTelemetry {
  id: string;
  homed: boolean;
  enabled: boolean;
  commanded_position: number;
  measured_position: number;
  velocity: number;
  endstop: boolean;
}

export interface Telemetry {
  seq: number;
  time_ms: number;
  state: RobotState;
  fault: Fault | null;
  mcu: McuStatus;
  axes: AxisTelemetry[];
}

// ---------------------------------------------------------------- config

export type AxisKind = "revolute" | "prismatic";

export interface McuConfig {
  name: string;
  board: string;
  transport: string;
  watchdog_ms: number;
}

export interface AxisConfig {
  id: string;
  name: string;
  kind: AxisKind;
  unit: string;
  min: number;
  max: number;
  max_velocity: number;
  max_acceleration: number;
  home_position: number | null;
  steps_per_unit: number;
  mcu: string;
  mcu_channel: number;
  actuator: string;
  step_pin: string;
  dir_pin: string;
  enable_pin: string;
  endstop_pin: string | null;
}

export interface RobotConfig {
  name: string;
  profile: string;
  mcus: McuConfig[];
  axes: AxisConfig[];
}

// ---------------------------------------------------------------- plugins

export type PluginState = "discovered" | "validated" | "resolved" | "initialized" | "active" | "failed" | "deactivated";

export interface Plugin {
  id: string;
  version: string;
  api_version: string;
  kind: string;
  description: string;
  provides: string[];
  requires: string[];
  permissions: string[];
  state: Open<PluginState>;
  error: string | null;
}

// ---------------------------------------------------------------- firmware

export interface FirmwareTarget {
  board: string;
  description: string;
  firmware_target: string;
  rust_target: string;
  step_channels: number;
  max_step_rate: number;
  provisional: boolean;
  is_virtual: boolean;
}

export type FirmwareJobKind = "build" | "flash";
export type FirmwareJobState = "queued" | "running" | "succeeded" | "failed";

export interface FirmwareArtifact {
  board: string;
  firmware_version: string;
  build_hash: string;
  image_sha256: string;
  toolchain: string;
  required_capabilities: string[];
}

export interface FirmwareJob {
  id: string;
  kind: Open<FirmwareJobKind>;
  state: Open<FirmwareJobState>;
  mcu: string;
  created_unix: number;
  finished_unix: number | null;
  message: string;
  log: string;
  artifact: FirmwareArtifact | null;
}

/** POST /api/firmware/builds body. Omitting `mcu` lets the server pick. */
export interface BuildRequest {
  mcu?: string;
}

/** POST /api/firmware/flashes body. `confirm` must be literally true. */
export interface FlashRequest {
  build_job_id: string;
  confirm: true;
}

// ---------------------------------------------------------------- logs / ws

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  time_ms: number;
  level: LogLevel;
  message: string;
}

/** Server -> client messages on GET /api/ws (commands go through REST). */
export type WsMessage =
  | { type: "engine"; data: { connected: boolean } }
  | { type: "telemetry"; data: Telemetry }
  | { type: "log"; data: LogEntry };

// ---------------------------------------------------------------- commands

type NoParams = Record<string, never>;

export interface CommandParams {
  enable: NoParams;
  disable: NoParams;
  stop: NoParams;
  estop: NoParams;
  reset_fault: NoParams;
  jog: { axis: string; delta: number; velocity?: number };
  move_to: { axis: string; position: number; velocity?: number };
  home: { axis: string };
}

export type CommandName = keyof CommandParams;

// ---------------------------------------------------------------- errors

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "not_homed"
  | "unauthorized"
  | "not_found"
  | "unknown_axis"
  | "unknown_command"
  | "invalid_state"
  | "mcu_error"
  | "engine_unavailable"
  | "engine_timeout"
  | "internal"
  /** Client-side only: the request never reached the server. */
  | "network_error";

/** Error envelope: `{"error": {"code": "...", "message": "..."}}`. */
export interface ErrorBody {
  error: { code: string; message: string };
}
