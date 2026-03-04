/**
 * Error class used for network/API transport failures.
 */
export class ActivityNetworkError extends Error {
  /**
   * @param {string} message
   * @param {{ endpoint?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ActivityNetworkError';
    this.endpoint = options.endpoint;
  }
}

/**
 * Error class used for local fallback file I/O failures.
 */
export class ActivityFileError extends Error {
  /**
   * @param {string} message
   * @param {{ filePath?: string, code?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ActivityFileError';
    this.filePath = options.filePath;
    this.code = options.code;
  }
}
