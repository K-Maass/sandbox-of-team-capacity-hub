import type { ActionError, ActionErrorCode } from "./contracts";

export class CapacityActionFailure extends Error {
  readonly detail: ActionError;

  constructor(
    code: ActionErrorCode,
    message: string,
    options: Pick<ActionError, "candidates" | "field"> = {},
  ) {
    super(message);
    this.name = "CapacityActionFailure";
    this.detail = { code, message, ...options };
  }
}
