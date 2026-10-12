import { basename } from "node:path";
import { failureKind, git, History, Mirror, parseRemote } from "@highwater/history";
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
  /** Hosts already asked to sign in this session (asked again only when the writer acts). */
  #asked = new Set<string>();
  /**
   * The last outcome. `error` is shown in the status bar's tooltip; `signIn` means mirroring waits
   * for the writer to sign in (retrying would only fail again).
   */
  state: { at: Date | null; error: string | null; signIn: boolean } = { at: null, error: null, signIn: false };
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
    if (!this.url || this.state.signIn) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.push(), delay);
  }

  /** Pushes; `interactive` when the writer asked for it (set-up, Sync Now), so questions may be asked again. */
  async push(interactive = false): Promise<boolean> {
    const url = this.url;
    if (!url) return false;
    const h = this.history();
    if (!(await exists(h))) return false; // nothing recorded yet
    const mirror = new Mirror(h, url, () => this.#auth(url));
    let result = await h.exclusive(() => mirror.push());
    // Needs a login (or a missing private repository the server will not admit to without one).
    if (!result.ok && result.kind === "auth" && (await this.#offerSignIn(url, interactive))) result = await h.exclusive(() => mirror.push());
    if (!result.ok && result.kind === "missing" && (interactive || !this.#offered.has(url))) {
      this.#offered.add(url);
      if (await this.#create(url, mirror)) result = await h.exclusive(() => mirror.push());
    }
    this.#record(result);
    return result.ok;
  }

  /**
   * Brings in what other computers pushed (their saves of shared works, and works only they have),
   * so the Writing History panel shows them before this computer saves. Returns the branches that
   * changed. Quiet when offline; a needed sign-in is shown in the status bar.
   */
  async pull(interactive = false): Promise<string[]> {
    const url = this.url;
    if (!url) return [];
    const h = this.history();
    const mirror = new Mirror(h, url, () => this.#auth(url));
    let result = await h.exclusive(() => mirror.pull());
    if (!result.ok && result.kind === "auth" && interactive && (await this.#offerSignIn(url, true))) result = await h.exclusive(() => mirror.pull());
    this.lastPull = Date.now();
    if (result.ok) return result.updated;
    if (result.kind === "auth" && !this.state.signIn) {
      this.state = { at: this.state.at, error: result.message, signIn: true };
      this.#changed.fire();
    }
    return [];
  }

  /**
   * Fetches one work's history from the mirror, because the writer asked for it (restoring it, or
   * connecting a file to it). Says what went wrong if it could not. True when it came.
   */
  async fetchWork(branch: string): Promise<boolean> {
    const url = this.url;
    if (!url) return false;
    const h = this.history();
    const mirror = new Mirror(h, url, () => this.#auth(url));
    const attempt = () => h.exclusive(() => mirror.fetchWork(branch)).then(() => null, (e: unknown) => (e as Error).message);
    let error = await attempt();
    if (error && failureKind(error) === "auth" && (await this.#offerSignIn(url, true))) error = await attempt();
    if (error) void vscode.window.showErrorMessage(`Could not fetch that work's history from ${url}: ${error.split("\n")[0]}`);
    return error === null;
  }

  /** When the last pull ran (ms), to space them out. */
  lastPull = 0;

  /** Pull, then push: what "Sync Writing History Now" does. */
  async sync(interactive = false): Promise<string[]> {
    const updated = await this.pull(interactive);
    await this.push(interactive);
    return updated;
  }

  /** Asks for the remote address, checks it, saves it and pushes. */
  async setUp(): Promise<void> {
    const url = await vscode.window.showInputBox({
      title: "Mirror the writing history",
      prompt: "A git remote address for one repository holding all your writing history. It is pushed to after saves and never overwritten.",
      placeHolder: "https://github.com/you/writing-history.git   ·   https://git.example.net/you/history.git   ·   git@host:you/history.git",
      value: this.url,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() && !parseRemote(v).name ? "That does not look like a git remote address." : null),
    });
    if (url === undefined) return;
    await vscode.workspace.getConfiguration("highwater").update("historyRemote", url.trim() || undefined, vscode.ConfigurationTarget.Global);
    if (!url.trim()) return;
    this.state = { at: null, error: null, signIn: false };
    this.#asked.delete(hostOf(url.trim()) ?? "");
    const h = this.history();
    // Bring in other computers' work first, then push: the push checks the address, asks for a
    // sign-in if the server wants one, and offers to create a missing repository.
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to the history mirror…" }, async () => {
      await h.exclusive(async () => {});
      await this.pull(true);
      return this.push(true);
    });
    if (ok) void vscode.window.showInformationMessage(`The writing history is mirrored to ${url.trim()}.`);
    else this.#explain();
  }

  /** Sign In to History Mirror…: asks for (or replaces) the login for the mirror's host, then syncs. */
  async signIn(): Promise<void> {
    const url = this.url;
    if (!url) {
      await this.setUp();
      return;
    }
    if (!(await this.#askLogin(url))) return;
    this.state = { ...this.state, signIn: false };
    await this.sync(true);
    if (!this.state.signIn && !this.state.error) void vscode.window.showInformationMessage(`Signed in: the writing history is mirrored to ${url}.`);
    else this.#explain();
  }

  /** Forget History Mirror Sign-In: removes the stored login for the mirror's host. */
  async forgetSignIn(): Promise<void> {
    const host = hostOf(this.url);
    if (!host) return void vscode.window.showInformationMessage("The history mirror does not use a stored sign-in.");
    await this.context.secrets.delete(loginKey(host));
    await this.context.secrets.delete(tokenKey(host));
    void vscode.window.showInformationMessage(`Forgot the sign-in for ${host}. You will be asked for it on the next push.`);
  }

  dispose(): void {
    clearTimeout(this.#timer);
    clearTimeout(this.#retry);
    this.#changed.dispose();
  }

  #record(result: { ok: true } | { ok: false; kind: string; message: string }): void {
    clearTimeout(this.#retry);
    if (result.ok) this.state = { at: new Date(), error: null, signIn: false };
    else {
      const signIn = result.kind === "auth";
      this.state = { at: this.state.at, error: result.message, signIn };
      // Offline or the server is down: try again in ten minutes (and on the next save). A refused
      // sign-in would only be refused again: wait for the writer.
      if (!signIn) this.#retry = setTimeout(() => void this.push(), 10 * 60_000);
    }
    this.#changed.fire();
  }

  /** Says what went wrong in words that lead somewhere. */
  #explain(): void {
    const url = this.url;
    const host = hostOf(url) ?? url;
    if (this.state.signIn) {
      void vscode.window.showWarningMessage(`The history mirror at ${host} needs you to sign in.`, "Sign In…").then((c) => c && this.signIn());
      return;
    }
    const error = this.state.error ?? "";
    const kind = failureKind(error);
    if (kind === "unreachable") void vscode.window.showWarningMessage(`Can't reach ${host} (${error}). The writing history will be mirrored when it can be reached; it is tried every ten minutes and after saves.`);
    else if (error) void vscode.window.showWarningMessage(`Could not mirror the writing history: ${error}`);
  }

  /** A login failed: ask to sign in (once a session unless the writer acted); true when a login was given. */
  async #offerSignIn(url: string, interactive: boolean): Promise<boolean> {
    const r = parseRemote(url);
    if (r.kind === "ssh" || r.kind === "local") return false; // SSH keys are set up outside VS Code
    if (r.kind === "github") {
      if (!interactive && this.#asked.has("github.com")) return false;
      this.#asked.add("github.com");
      const choice = await vscode.window.showWarningMessage("Sign in to GitHub to mirror your writing history there?", "Sign In");
      return choice === "Sign In" && !!(await vscode.authentication.getSession("github", ["repo"], { createIfNone: true }).then((s) => s, () => undefined));
    }
    const host = r.host!;
    if (!interactive && this.#asked.has(host)) return false;
    this.#asked.add(host);
    const stored = await this.context.secrets.get(loginKey(host));
    const message = stored ? `${host} refused the stored sign-in for the writing history mirror.` : `${host} needs you to sign in to mirror the writing history.`;
    const choice = interactive ? "Sign In…" : await vscode.window.showWarningMessage(message, "Sign In…");
    if (choice !== "Sign In…") return false;
    return this.#askLogin(url);
  }

  /** Asks for a username and access token for an HTTPS host and keeps them in VS Code's secure storage. */
  async #askLogin(url: string): Promise<boolean> {
    const r = parseRemote(url);
    if (r.kind === "github") return !!(await vscode.authentication.getSession("github", ["repo"], { createIfNone: true }).then((s) => s, () => undefined));
    if (r.kind !== "https" && r.kind !== "gitlab") {
      void vscode.window.showInformationMessage(`${url} is reached over SSH: sign-in uses your SSH key, set up outside VS Code.`);
      return false;
    }
    const host = r.host!;
    const gitea = await isGitea(host);
    const tokenPage = gitea ? `https://${host}/user/settings/applications` : r.kind === "gitlab" ? "https://gitlab.com/-/user_settings/personal_access_tokens" : null;
    const previous = parseLogin(await this.context.secrets.get(loginKey(host)));
    const username = await vscode.window.showInputBox({
      title: `Sign in to ${host} (1/2)`,
      prompt: "Your username on the server.",
      value: previous?.username ?? r.owner ?? "",
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? null : "Enter your username."),
    });
    if (!username) return false;
    if (tokenPage) {
      const open = await vscode.window.showInformationMessage(
        `Next: an access token for ${host}. Make one on the server's token page with permission to read and write repositories${gitea ? " (Gitea and Forgejo: \"repository: Read and Write\")" : ""}, then paste it.`,
        { modal: true },
        "Open Token Page",
        "I Have a Token",
      );
      if (!open) return false;
      if (open === "Open Token Page") await vscode.env.openExternal(vscode.Uri.parse(tokenPage));
    }
    const token = await vscode.window.showInputBox({
      title: `Sign in to ${host} (2/2)`,
      prompt: "An access token (or password). Kept in VS Code's secure storage and sent only to this server.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? null : "Paste the token."),
    });
    if (!token) return false;
    await this.context.secrets.store(loginKey(host), JSON.stringify({ username: username.trim(), token: token.trim() }));
    // Also the token for creating a missing repository (Gitea, Forgejo).
    await this.context.secrets.store(tokenKey(host), token.trim());
    this.#asked.delete(host);
    return true;
  }

  /**
   * Git options carrying the login for this push or pull, for this host only: VS Code's GitHub
   * sign-in for github.com, the stored login for other HTTPS hosts. With none stored, git's own
   * credential helper (the Mac keychain, say) is used, without prompting.
   */
  async #auth(url: string): Promise<string[]> {
    const r = parseRemote(url);
    if (!/^https?:/i.test(url) || !r.host) return [];
    let basic: string | null = null;
    if (r.kind === "github") {
      const session = await vscode.authentication.getSession("github", ["repo"], { silent: true }).then(
        (s) => s,
        () => undefined,
      );
      if (session) basic = `x-access-token:${session.accessToken}`;
    } else {
      const login = parseLogin(await this.context.secrets.get(loginKey(r.host)));
      if (login) basic = `${login.username}:${login.token}`;
    }
    if (!basic) return [];
    const origin = new URL(url).origin;
    return ["-c", `http.${origin}/.extraheader=AUTHORIZATION: basic ${Buffer.from(basic).toString("base64")}`];
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
        const key = tokenKey(r.host);
        let token = (await this.context.secrets.get(key)) ?? parseLogin(await this.context.secrets.get(loginKey(r.host)))?.token;
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

const loginKey = (host: string) => `highwater.login:${host}`;
const tokenKey = (host: string) => `highwater.token:${host}`;

function hostOf(url: string): string | null {
  return url ? parseRemote(url).host : null;
}

function parseLogin(raw: string | undefined): { username: string; token: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { username?: unknown; token?: unknown };
    return typeof v.username === "string" && typeof v.token === "string" ? { username: v.username, token: v.token } : null;
  } catch {
    return null;
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
