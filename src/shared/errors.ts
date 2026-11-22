/** An error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'bad_request', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'conflict', message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export function errorBody(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ErrorBody {
  return { error: { code, message, requestId, ...(details !== undefined && { details }) } };
}
