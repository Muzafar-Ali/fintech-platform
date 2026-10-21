export class InvalidDatabaseConfigError extends Error {
  public readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid database configuration: ${fields.join(', ')}`);

    this.name = 'InvalidDatabaseConfigError';
    this.fields = [...fields];
  }
}
