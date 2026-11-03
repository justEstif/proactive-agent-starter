// Error codes and the wire error envelope every route answers with.
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "busy"
  | "conflict"
  | "unavailable"
  | "offline"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  busy: 409,
  conflict: 409,
  unavailable: 503,
  offline: 503,
  internal: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = STATUS[code];
  }
}
