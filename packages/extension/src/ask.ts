import * as vscode from "vscode";

/**
 * Every question Highwater Too puts to the writer goes through here: messages with choices, pick
 * lists and text boxes. In normal use these are VS Code's own. Under the end-to-end tests nobody
 * can click, so a test scripts its answers in advance (`highwater.test.answer`) and reads back
 * exactly what was asked (`highwater.test.asked`). The next scripted answer is used by the first
 * question it fits (one of its choices); any other question is dismissed, as if by Escape.
 * Plain notices with nothing to choose stay ordinary VS Code messages.
 */
export type Level = "info" | "warning" | "error";

/** A question as it was put, for the tests. */
export interface Asked {
  kind: "message" | "pick" | "text";
  level?: Level;
  message: string;
  detail?: string;
  modal?: boolean;
  choices: string[];
}

type Answer = string | string[] | undefined;
/** A scripted answer that dismisses the question it reaches (null in `highwater.test.answer`). */
const DISMISS: unique symbol = Symbol("dismiss");

/** The scripted answers, in the order the questions come; null outside the tests. */
let script: (string | string[] | typeof DISMISS)[] | null = null;
const asked: Asked[] = [];

export function registerAsk(context: vscode.ExtensionContext): void {
  if (context.extensionMode !== vscode.ExtensionMode.Test) return;
  script = [];
  context.subscriptions.push(
    // null answers a question by dismissing it (Escape, Cancel).
    vscode.commands.registerCommand("highwater.test.answer", (...answers: (string | string[] | null)[]) => void script!.push(...answers.map((a) => a ?? DISMISS))),
    vscode.commands.registerCommand("highwater.test.asked", () => asked.splice(0)),
  );
}

function scripted(q: Asked): Answer {
  asked.push(q);
  if (!script!.length) return undefined;
  const next = script![0];
  const fits = next === DISMISS || (q.kind === "text" ? typeof next === "string" : [next].flat().every((a) => q.choices.includes(a as string)));
  if (!fits) return undefined;
  script!.shift();
  return next === DISMISS ? undefined : (next as Answer);
}

const titleOf = (item: string | vscode.MessageItem): string => (typeof item === "string" ? item : item.title);

/** A message with choices (VS Code's showInformationMessage, showWarningMessage, showErrorMessage). */
export async function ask<T extends string | vscode.MessageItem>(level: Level, message: string, options: vscode.MessageOptions, ...items: T[]): Promise<T | undefined> {
  if (script) {
    const answer = scripted({ kind: "message", level, message, ...(options.detail ? { detail: options.detail } : {}), ...(options.modal ? { modal: true } : {}), choices: items.map(titleOf) });
    return items.find((i) => titleOf(i) === answer);
  }
  const show = level === "info" ? vscode.window.showInformationMessage : level === "warning" ? vscode.window.showWarningMessage : vscode.window.showErrorMessage;
  return show(message, options, ...(items as never[])) as Promise<T | undefined>;
}

/** A pick list (VS Code's showQuickPick). Scripted answers name items by label. */
export function pick<T extends vscode.QuickPickItem>(items: readonly T[] | Thenable<readonly T[]>, options: vscode.QuickPickOptions & { canPickMany: true }): Promise<T[] | undefined>;
export function pick<T extends vscode.QuickPickItem>(items: readonly T[] | Thenable<readonly T[]>, options?: vscode.QuickPickOptions): Promise<T | undefined>;
export async function pick<T extends vscode.QuickPickItem>(items: readonly T[] | Thenable<readonly T[]>, options: vscode.QuickPickOptions = {}): Promise<T | T[] | undefined> {
  if (script) {
    const list = await items;
    const answer = scripted({ kind: "pick", message: options.title ?? options.placeHolder ?? "", choices: list.map((i) => i.label) });
    if (options.canPickMany) return answer === undefined ? undefined : list.filter((i) => [answer].flat().includes(i.label));
    return list.find((i) => i.label === answer);
  }
  return vscode.window.showQuickPick(items as T[] | Thenable<T[]>, options) as Promise<T | T[] | undefined>;
}

/** A text box (VS Code's showInputBox). */
export async function askText(options: vscode.InputBoxOptions): Promise<string | undefined> {
  if (script) {
    const answer = scripted({ kind: "text", message: options.title ?? options.prompt ?? "", choices: [] });
    return typeof answer === "string" ? answer : undefined;
  }
  return vscode.window.showInputBox(options);
}
