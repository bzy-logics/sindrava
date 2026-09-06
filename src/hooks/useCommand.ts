import { useCallback } from "react";
import { api, ApiError } from "../api";
import type { CommandName, CommandParams } from "../types/api";
import { useToast } from "../components/Toasts";

const COMMAND_LABEL: Record<CommandName, string> = {
  enable: "Enable",
  disable: "Disable",
  stop: "Stop",
  estop: "E-STOP",
  reset_fault: "Reset fault",
  jog: "Jog",
  move_to: "Move",
  home: "Home",
};

/** Toast an API failure as "<label> failed: <code>". */
export function useErrorToast() {
  const toast = useToast();
  return useCallback(
    (label: string, e: unknown) => {
      if (e instanceof ApiError) toast("error", `${label} failed: ${e.code}`, e.message);
      else toast("error", `${label} failed`, String(e));
    },
    [toast],
  );
}

/** Send a command; failures surface as toasts. Resolves true on success. */
export function useCommand() {
  const fail = useErrorToast();
  return useCallback(
    async <C extends CommandName>(name: C, params: CommandParams[C]): Promise<boolean> => {
      try {
        await api.command(name, params);
        return true;
      } catch (e) {
        fail(COMMAND_LABEL[name], e);
        return false;
      }
    },
    [fail],
  );
}
