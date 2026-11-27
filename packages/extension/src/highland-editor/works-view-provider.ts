/**
 * The Works view in VS Code's own Highwater Too sidebar (EJ, 2026-11-26): the Works panel of the
 * Highwater Editor's sidebar, for when no Highwater Editor is in front, so a work can be opened, or
 * restored from the writing history or the mirror, with no document open. Its page is
 * works-view-html.ts and works-view.ts; the works themselves come from works-host.ts, as in the editor.
 * While a Highwater Editor is in front, the sidebar has only the note (sidebar-note.ts) instead.
 */
import * as vscode from "vscode";
import { postTo, type FromPage, type ToPage } from "./messages.ts";
import { worksHost, type WorksHost } from "./works-host.ts";
import { worksViewHtml } from "./works-view-html.ts";

export const WORKS_VIEW = "highwater.works";

/** For the end-to-end tests: whether the view's page is showing and ready, the works it was last sent, and a message as if from it. */
export const worksViewForTests = {
  ready: false,
  works: [] as { title: string; file: string; kind: string }[],
  receive: (_msg: FromPage): boolean => false,
};

export function registerWorksView(context: vscode.ExtensionContext): void {
  const dist = vscode.Uri.joinPath(context.extensionUri, "dist");
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WORKS_VIEW, {
      resolveWebviewView(view) {
        const webview = view.webview;
        webview.options = { enableScripts: true, localResourceRoots: [dist] };
        let disposed = false;
        const post = (msg: ToPage) => {
          if (disposed) return;
          if (msg.type === "works") worksViewForTests.works = msg.items.map((w) => ({ title: w.title, file: w.file, kind: w.kind }));
          postTo(view, msg);
        };
        const host: WorksHost = worksHost(post);
        const receive = (msg: FromPage): boolean => {
          if (msg.type === "ready") {
            worksViewForTests.ready = true;
            host.ready();
          } else if (msg.type === "worksViewCommand" && (msg.command === "highwater.open" || msg.command === "highwater.newDocument")) {
            void vscode.commands.executeCommand(msg.command);
          } else if (msg.type === "historyCommand" && msg.command === "highwater.signInHistoryMirror") {
            // The Works panel's "Mirror needs you to sign in".
            void vscode.commands.executeCommand(msg.command);
          } else return host.handle(msg);
          return true;
        };
        worksViewForTests.receive = receive;
        const subscription = webview.onDidReceiveMessage((msg: FromPage) => void receive(msg));
        view.onDidDispose(() => {
          disposed = true;
          worksViewForTests.ready = false;
          worksViewForTests.receive = () => false;
          subscription.dispose();
          host.dispose();
        });
        webview.html = worksViewHtml({
          cspSource: webview.cspSource,
          nonce: Math.random().toString(36).slice(2),
          script: String(webview.asWebviewUri(vscode.Uri.joinPath(dist, "works-view.js"))),
        });
      },
    }),
  );
}
