/**
 * The idempotency key already belongs to a different
 * financial command within the same tenant and operation.
 */
export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different financial command');
    this.name = 'IdempotencyConflictError';
  }
}
