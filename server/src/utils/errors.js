/** A request that violates a business rule. Surfaced to the client with its HTTP status and message. */
export class BusinessRuleError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = "BusinessRuleError";
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends BusinessRuleError {
  constructor(message = "Not found") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class HttpError extends BusinessRuleError {}

export const badRequest = (message) => new BusinessRuleError(message, 400);
export const forbidden = (message = "You do not have access to this area") => new BusinessRuleError(message, 403);
export const unauthorized = (message = "Please sign in") => new BusinessRuleError(message, 401);
