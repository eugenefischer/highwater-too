/**
 * A stand-in for the "vscode" module, for unit tests of code that imports it (vitest.config.ts
 * points "vscode" here). Only what those tests reach does anything: event emitters, file URIs and
 * a few enums; every other namespace function returns undefined.
 */
export class EventEmitter<T> {
  #listeners = new Set<(e: T) => unknown>();
  event = (listener: (e: T) => unknown) => {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  };
  fire(e: T): void {
    for (const l of [...this.#listeners]) l(e);
  }
  dispose(): void {
    this.#listeners.clear();
  }
}

export class Disposable {
  constructor(private readonly f: () => void) {}
  dispose(): void {
    this.f();
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = "",
  ) {}
  static file(path: string): Uri {
    return new Uri("file", path);
  }
  static from(c: { scheme: string; path: string; query?: string }): Uri {
    return new Uri(c.scheme, c.path, c.query);
  }
  get fsPath(): string {
    return this.path;
  }
  with(c: { scheme?: string; path?: string; query?: string }): Uri {
    return new Uri(c.scheme ?? this.scheme, c.path ?? this.path, c.query ?? this.query);
  }
  toString(): string {
    return `${this.scheme}:${this.path}${this.query ? `?${this.query}` : ""}`;
  }
}

export const FileChangeType = { Changed: 1, Created: 2, Deleted: 3 } as const;
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;
export const ExtensionMode = { Production: 1, Development: 2, Test: 3 } as const;
export const ViewColumn = { Active: -1, Beside: -2, One: 1 } as const;
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export class FileSystemError extends Error {
  static FileNotFound = (m?: unknown) => new FileSystemError(String(m));
  static FileExists = (m?: unknown) => new FileSystemError(String(m));
  static NoPermissions = (m?: unknown) => new FileSystemError(String(m));
  static Unavailable = (m?: unknown) => new FileSystemError(String(m));
}

/** Messages and questions shown, and the answers to give (first in, first out). */
export const shown: { kind: string; message: string; choices: string[] }[] = [];
export const answers: (string | undefined)[] = [];
const say =
  (kind: string) =>
  async (message: string, ...rest: unknown[]) => {
    const choices = rest.filter((r): r is string => typeof r === "string");
    shown.push({ kind, message, choices });
    return answers.shift();
  };

const none = () => undefined;
const namespace = (fields: Record<string, unknown>) => new Proxy(fields, { get: (t, k) => (k in t ? t[k as string] : none) });

export const window = namespace({ showInformationMessage: say("info"), showWarningMessage: say("warning"), showErrorMessage: say("error"), tabGroups: { all: [], activeTabGroup: {} }, visibleTextEditors: [] });
export const workspace = namespace({ textDocuments: [], getConfiguration: () => ({ get: (_: string, d: unknown) => d }), registerFileSystemProvider: () => new Disposable(none) });
export const commands = namespace({ executeCommand: async () => undefined, registerCommand: () => new Disposable(none) });
export const languages = namespace({});
export const env = namespace({});
