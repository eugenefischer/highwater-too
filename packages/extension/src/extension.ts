import * as vscode from "vscode";

/** VS Code glue only; all format, parsing and layout logic lives in the other packages. */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("highwater.hello", () => {
      const version = String(context.extension.packageJSON.version ?? "unknown");
      void vscode.window.showInformationMessage(`Highwater Too ${version}`);
    }),
  );
}

export function deactivate(): void {}
