/** Typed errors so consumers (host/mcp) can map to sensible responses. */

export class EngineError extends Error {
  constructor(
    message: string,
    readonly code: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

/** Thrown when an operation would escape the tool-owned workspace. */
export class ReadOnlyViolationError extends EngineError {
  constructor(attemptedPath: string) {
    super(
      `Refusing to write outside the tool workspace: ${attemptedPath}`,
      'READONLY_VIOLATION',
    );
    this.name = 'ReadOnlyViolationError';
  }
}

export class ProjectLoadError extends EngineError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PROJECT_LOAD_FAILED', cause);
    this.name = 'ProjectLoadError';
  }
}

export class UnsupportedFrameworkError extends EngineError {
  constructor(detected: string) {
    super(`No adapter registered for framework: ${detected}`, 'UNSUPPORTED_FRAMEWORK');
    this.name = 'UnsupportedFrameworkError';
  }
}

export class ComponentNotFoundError extends EngineError {
  constructor(id: string) {
    super(`Component not found: ${id}`, 'COMPONENT_NOT_FOUND');
    this.name = 'ComponentNotFoundError';
  }
}
