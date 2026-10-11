import { basename } from "node:path";
import { git, History, Mirror, parseRemote } from "@highwater/history";
import * as vscode from "vscode";

/**
 * Mirroring the writing history to one git remote (any host): pushes after saves, never forces,
 * creates the remote repository when it is missing (GitHub or Gitea/Forgejo API, SSH, a local
 * path), and uses VS Code's GitHub sign-in for github.com over HTTPS.
 */
export class HistoryMirror implements vscode.Disposable {
  #timer: NodeJS.Timeout | undefined;
  #retry: NodeJS.Timeout | undefined;
  #offered = new Set<string>();
  state: { at: Date | null; error: string | null } = { at: null, error: null };
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.#changed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly history: () => History,
  ) {}

  get url(): string {
    return vscode.workspace.getConfiguration("highwater").get<string>("historyRemote", "").trim();
  }

  /** After a commit: push a few seconds later (several quick saves make one push). */
  schedule(delay = 5000): void {
    if (!this.url) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.push(), delay);
  }

  async push(interactive = false): Promise<boolean> {
    const url = this.url;
    if (!url) return false;
    const h = this.history();
    if (!(await exists(h))) return false; // nothing recorded yet
    const mirror = new Mirror(h, url, () => this.#auth(url));
    let result = await h.exclusive(() => mirror.push());
    if (!result.ok && result.missing && (interactive || !this.#offered.has(url))) {
      this.#offered.add(url);
      if (await this.#create(url, mirror)) result = await h.exclusive(() => mirror.push());
    }
    if (!result.ok && /authentication|could not read username|403|401|permission denied/i.test(result.message) && parseRemote(url).kind === "github" && /^https/i.test(url)) {
      const choice = await vscode.window.showWarningMessage("Sign in to GitHub to mirror your writing history there?", "Sign In");
      if (choice === "Sign In" && (await vscode.authentication.getSession("github", ["repo"], { createIfNone: true }))) result = await h.exclusive(() => mirror.push());
    }
    clearTimeout(this.#retry);
    if (result.ok) this.state = { at: new Date(), error: null };
    else {
      this.state = { at: this.state.at, error: result.message };
      // Offline or the server is down: try again in ten minutes (and on the next save).
      this.#retry = setTimeout(() => void this.push(), 10 * 60_000);
    }
    this.#changed.fire();
    return result.ok;
  }

  /**
   * Brings in what other computers pushed (their saves of shared works, and works only they have),
   * so the Writing History panel shows them before this computer saves. Returns the branches that
   * changed. Quiet on failure: offline is normal, and pushing reports problems.
   */
  async pull(): Promise<string[]> {
    const url = this.url;
    if (!url) return [];
    const h = this.history();
    const result = await h.exclusive(() => new Mirror(h, url, () => this.#auth(url)).pull());
    this.lastPull = Date.now();
    if (!result.ok) return [];
    return result.updated;
  }

  /** When the last pull ran (ms), to space them out. */
  lastPull = 0;

  /** Pull, then push: what "Sync Writing History Now" does. */
  async sync(interactive = false): Promise<string[]> {
    const updated = await this.pull();
    await this.push(interactive);
    return updated;
  }

  /** Asks for the remote address, saves it and pushes. */
  async setUp(): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: "Mirror the writing history",
      prompt: "A git remote address for one repository holding all your writing history. It is pushed to after saves and never overwritten.",
      placeHolder: "https://github.com/you/writing-history.git   ·   git@host:you/history.git   ·   ssh://you@server/path/history.git",
      value: this.url,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() && !parseRemote(v).name ? "That does not look like a git remote address." : null),
    });
    if (url === undefined) return;
    await vscode.workspace.getConfiguration("highwater").update("historyRemote", url.trim() || undefined, vscode.ConfigurationTarget.Global);
    if (!url.trim()) return;
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Mirroring the writing history…" }, () => this.push(true));
    if (ok) void vscode.window.showInformationMessage(`The writing history is mirrored to ${url.trim()}.`);
    else if (this.state.error) void vscode.window.showWarningMessage(`Could not mirror the writing history yet: ${this.state.error}. It will be tried again after the next save.`);
  }

  dispose(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#retry);
    this.#changed.dispose();
  }

  /** github.com over HTTPS: the token from VS Code's GitHub sign-in, if signed in. */
  async #auth(url: string): Promise<string[]> {
    const r = parseRemote(url);
    if (r.kind !== "github" || !/^https/i.test(url)) return [];
    const session = await vscode.authentication.getSession("github", ["repo"], { silent: true }).then(
      (s) => s,
      () => undefined,
    );
    if (!session) return [];
    const basic = Buffer.from(`x-access-token:${session.accessToken}`).toString("base64");
    return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
  }

  /** The remote repository is missing: offer to create it, the way that fits the address. */
  async #create(url: string, mirror: Mirror): Promise<boolean> {
    const r = parseRemote(url);
    const name = r.name ?? "writing-history";
    try {
      if (r.kind === "github") {
        if ((await vscode.window.showInformationMessage(`There is no repository at ${url} yet. Create it on GitHub, private?`, "Create")) !== "Create") return false;
        const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
        const mine = r.owner === null || r.owner.toLowerCase() === session.account.label.toLowerCase();
        await api(`https://api.github.com/${mine ? "user" : `orgs/${r.owner}`}/repos`, `Bearer ${session.accessToken}`, { name, private: true, description: "Writing history kept by Highwater Too" });
        return true;
      }
      if (r.kind === "ssh") {
        if ((await vscode.window.showInformationMessage(`There is no repository at ${url} yet. Create it on ${r.host} over SSH (git init --bare)?`, "Create")) !== "Create") return false;
        await mirror.createOverSsh();
        return true;
      }
      if (r.kind === "local") {
        if ((await vscode.window.showInformationMessage(`There is no repository at ${url} yet. Create it?`, "Create")) !== "Create") return false;
        await git(process.cwd(), ["init", "-q", "--bare", r.path]);
        return true;
      }
      if (r.kind === "https" && r.host && (await isGitea(r.host))) {
        if ((await vscode.window.showInformationMessage(`There is no repository at ${url} yet. Create it on ${r.host}, private? You will be asked for an access token with permission to create repositories.`, "Create")) !== "Create") return false;
        const key = `highwater.token:${r.host}`;
        let token = await this.context.secrets.get(key);
        token ??= await vscode.window.showInputBox({ title: `Access token for ${r.host}`, password: true, ignoreFocusOut: true, prompt: "Kept in VS Code's secure storage." });
        if (!token) return false;
        await this.context.secrets.store(key, token);
        const user = await api(`https://${r.host}/api/v1/user`, `token ${token}`);
        const mine = r.owner === null || r.owner.toLowerCase() === String((user as { login?: string }).login ?? "").toLowerCase();
        await api(`https://${r.host}/api/v1/${mine ? "user" : `orgs/${r.owner}`}/repos`, `token ${token}`, { name, private: true, description: "Writing history kept by Highwater Too" });
        return true;
      }
      void vscode.window.showWarningMessage(`There is no repository at ${url} yet. Create an empty one there (most hosts have a "New repository" button), then save again.`);
      return false;
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not create the repository: ${(error as Error).message}`);
      return false;
    }
  }
}

async function exists(h: History): Promise<boolean> {
  const { existsSync } = await import("node:fs");
  return existsSync(h.repo);
}

async function isGitea(host: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${host}/api/v1/version`, { signal: AbortSignal.timeout(5000) });
    return res.ok && typeof ((await res.json()) as { version?: unknown }).version === "string";
  } catch {
    return false;
  }
}

async function api(url: string, authorization: string, body?: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { authorization, accept: "application/json", "content-type": "application/json", "user-agent": "Highwater Too" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Writes one document's history to a .bundle file chosen by the writer. */
export async function exportHistory(h: History, id: string, documentPath: string): Promise<void> {
  const name = basename(documentPath).replace(/\.(highland|fountain|spmd|md|markdown|txt)$/i, "");
  const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(documentPath.replace(/[^/\\]+$/, `${name} writing history.bundle`)), filters: { "Git bundle": ["bundle"] }, title: "Export writing history" });
  if (!target) return;
  await h.bundle(id, target.fsPath);
  const choice = await vscode.window.showInformationMessage(
    `Exported the writing history of ${name}. Anyone with git can open it: git clone "${basename(target.fsPath)}". Only this work is in it.`,
    "Show File",
  );
  if (choice) void vscode.commands.executeCommand("revealFileInOS", target);
}
