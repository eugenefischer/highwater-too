import type { Document, Element, Mode, PlacedDirective } from "./ast.ts";
import { parse } from "./parse.ts";

/** A file taking part in an include tree. */
export interface IncludeFile {
  /** Stable identity used for cycle detection, e.g. the absolute path. */
  id: string;
  /** Shown in messages, e.g. the path as written in the directive. */
  name: string;
  source: string;
}

/**
 * Loads `path` (as written in the directive, relative to `from`). Returns null when the file does
 * not exist. For a .highland file it returns the bundle's text. The parser never touches the disk.
 */
export type IncludeLoader = (path: string, from: IncludeFile) => Promise<IncludeFile | null>;

export interface ResolvedInclude {
  directive: PlacedDirective;
  /** Null when the file could not be included; see `error`. */
  document: ResolvedDocument | null;
  error: string | null;
}

export interface ResolvedDocument {
  file: IncludeFile;
  document: Document;
  includes: ResolvedInclude[];
}

/** An element of the merged document and the file its spans refer to (the source map). */
export interface MergedElement {
  element: Element;
  file: IncludeFile;
}

export interface IncludeProblem {
  file: IncludeFile;
  directive: PlacedDirective;
  message: string;
}

export interface IncludeResult {
  tree: ResolvedDocument;
  /** Elements in print order, each included file's elements right after its INCLUDE line. */
  elements: MergedElement[];
  problems: IncludeProblem[];
}

/**
 * Resolves `{{INCLUDE: path}}` lines recursively and merges the elements for printing. Included
 * files are parsed in the including document's mode (Highland inlines their text) and their title
 * pages are dropped. Missing files and cycles are reported, not thrown.
 */
export async function resolveIncludes(root: IncludeFile, mode: Mode, load: IncludeLoader, options: { maxDepth?: number } = {}): Promise<IncludeResult> {
  const maxDepth = options.maxDepth ?? 16;
  const problems: IncludeProblem[] = [];

  async function resolve(file: IncludeFile, stack: string[]): Promise<ResolvedDocument> {
    const document = parse(file.source, { mode });
    const includes: ResolvedInclude[] = [];
    for (const directive of document.directives) {
      if (directive.directive.kind !== "include" || directive.inline || directive.directive.path === "") continue;
      const path = directive.directive.path;
      const fail = (error: string): void => {
        includes.push({ directive, document: null, error });
        problems.push({ file, directive, message: error });
      };
      if (stack.length >= maxDepth) {
        fail(`Includes are nested more than ${maxDepth} deep at "${path}"`);
        continue;
      }
      let target: IncludeFile | null;
      try {
        target = await load(path, file);
      } catch (e) {
        fail(`Could not read included file "${path}": ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (!target) {
        fail(`Included file not found: "${path}"`);
        continue;
      }
      if (stack.includes(target.id)) {
        fail(`Include cycle: ${[...stack, target.id].join(" → ")}`);
        continue;
      }
      includes.push({ directive, document: await resolve(target, [...stack, target.id]), error: null });
    }
    return { file, document, includes };
  }

  const tree = await resolve(root, [root.id]);
  const elements: MergedElement[] = [];
  const merge = (r: ResolvedDocument): void => {
    for (const element of r.document.elements) {
      elements.push({ element, file: r.file });
      if (element.kind !== "directiveLine") continue;
      for (const inc of r.includes) {
        if (inc.document && element.directives.includes(inc.directive)) merge(inc.document);
      }
    }
  };
  merge(tree);
  return { tree, elements, problems };
}
