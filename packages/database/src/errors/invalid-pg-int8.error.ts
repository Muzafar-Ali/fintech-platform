export class InvalidPgInt8Error extends Error {
  constructor() {
    super('Invalid PostgreSQL BIGINT value');

    this.name = 'InvalidPgInt8Error';
  }
}
