import { execFile } from "node:child_process";
import { git, GitError } from "./git.ts";
import type { History } from "./history.ts";

/** What a remote address says about where it points. */
export interface RemoteInfo {
  url: string;
  /** github / gitlab: hosts we know; ssh: some SSH server; https: some HTTPS server; local: a path. */
  kind: "github" | "gitlab" | "ssh" | "https" | "local";
  host: string | null;
  /** For ssh: the login (user@host); for scp-like addresses, the path is relative to the home folder. */
  login: string | null;
  /** For ssh:// addresses with a port. */
  port: string | null;
  /** The repository path on the server, e.g. "ej/writing-history.git". */
  path: string;
  owner: string | null;
  name: string | null;
}

/** Reads a git remote address: https://host/owner/name.git, ssh://user@host/path, user@host:path, or a local path. */
export function parseRemote(url: string): RemoteInfo {
  const u = url.trim();
  let host: string | null = null;
  let login: string | null = null;
  let port: string | null = null;
  let path = u;
  let scheme: "ssh" | "https" | "local" = "local";
  const scp = /^([^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(u);
  if (/^(ssh|git\+ssh):\/\//i.test(u)) {
    const parsed = new URL(u.replace(/^git\+ssh:/i, "ssh:"));
    host = parsed.hostname;
    login = `${parsed.username ? `${parsed.username}@` : ""}${parsed.hostname}`;
    port = parsed.port || null;
    path = decodeURIComponent(parsed.pathname);
    scheme = "ssh";
  } else if (/^https?:\/\//i.test(u)) {
    const parsed = new URL(u);
    host = parsed.host;
    path = decodeURIComponent(parsed.pathname).replace(/^\//, "");
    scheme = "https";
  } else if (scp && !/^[A-Za-z]:[\\/]/.test(u)) {
    host = scp[2]!;
    login = `${scp[1] ?? ""}${scp[2]}`;
    path = scp[3]!;
    scheme = "ssh";
  }
  const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
  const name = segments.length ? segments.at(-1)!.replace(/\.git$/, "") : null;
  const owner = segments.length >= 2 ? segments.at(-2)! : null;
  const bare = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  const kind = bare === "github.com" ? "github" : bare === "gitlab.com" ? "gitlab" : scheme;
  return { url: u, kind, host, login, port, path, owner, name };
}

export type PushResult =
  | { ok: true; pushed: number }
  | { ok: false; missing: boolean; message: string };

export type PullResult =
  | { ok: true; updated: string[] }
  | { ok: false; missing: boolean; message: string };

const REMOTE = "mirror";

/**
 * Mirrors the history repository to one remote, append-only: never force-pushes. A branch that
 * another computer has moved ahead is merged (a commit with both as parents, keeping this
 * computer's text), so neither history is lost and nothing is rewritten.
 */
export class Mirror {
  readonly history: History;
  readonly url: string;
  /** Extra git options for authentication, e.g. ["-c", "http.extraHeader=…"]. */
  readonly auth: () => Promise<string[]>;

  constructor(history: History, url: string, auth: () => Promise<string[]> = async () => []) {
    this.history = history;
    this.url = url;
    this.auth = auth;
  }

  /** Pushes every branch (main and each work). Branches already up to date cost nothing. */
  async push(): Promise<PushResult> {
    const repo = this.history.repo;
    try {
      await this.#remote();
      const branches = (await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])).split("\n").filter(Boolean);
      const rejected: string[] = [];
      const out = await this.#git(["push", "--porcelain", REMOTE, ...branches.map((b) => `refs/heads/${b}:refs/heads/${b}`)]).catch((e: unknown) => {
        // Rejected branches still print porcelain lines ("!\t…"); keep them, rethrow real failures.
        if (e instanceof GitError && /^!\t/m.test(e.stdout)) return e.stdout;
        throw e;
      });
      for (const line of out.split("\n")) {
        const m = /^!\trefs\/heads\/(.+?):refs\/heads\//.exec(line);
        if (m) rejected.push(m[1]!);
      }
      for (const branch of rejected) await this.#mergeRemote(branch);
      if (rejected.length) await this.#git(["push", "--porcelain", REMOTE, ...rejected.map((b) => `refs/heads/${b}:refs/heads/${b}`)]);
      return { ok: true, pushed: branches.length };
    } catch (error) {
      const message = (error as Error).message;
      const missing = /not found|does not appear to be a git repository|repository .* does not exist|could not read from remote|no such file or directory|not a git repository/i.test(message);
      return { ok: false, missing, message: shorten(message) };
    }
  }

  /**
   * Brings in what other computers pushed: every branch on the remote is fetched; a branch this
   * computer lacks is created, one it is behind on moves forward, and one that both have moved is
   * joined with a merge commit (keeping this computer's text). Nothing local is ever lost.
   * Returns the branches that changed here.
   */
  async pull(): Promise<PullResult> {
    const repo = this.history.repo;
    try {
      await this.#remote();
      await this.#git(["fetch", "-q", "--prune", REMOTE, "+refs/heads/*:refs/mirror/*"]);
      const remote = (await git(repo, ["for-each-ref", "--format=%(refname)", "refs/mirror/"])).split("\n").filter(Boolean).map((r) => r.replace(/^refs\/mirror\//, ""));
      const updated: string[] = [];
      for (const branch of remote) if (await this.#join(branch)) updated.push(branch);
      return { ok: true, updated };
    } catch (error) {
      const message = (error as Error).message;
      // A remote with nothing pushed yet has no branches to fetch: nothing to pull.
      if (/couldn't find remote ref|no matching remote head/i.test(message)) return { ok: true, updated: [] };
      const missing = /not found|does not appear to be a git repository|repository .* does not exist|could not read from remote|no such file or directory|not a git repository/i.test(message);
      return { ok: false, missing, message: shorten(message) };
    }
  }

  /** Creates the remote repository over SSH (`git init --bare`), for servers without an API. */
  async createOverSsh(): Promise<void> {
    const r = parseRemote(this.url);
    if (r.kind !== "ssh" || !r.login) throw new Error("not an SSH address");
    // ssh:// paths are absolute; scp-style paths (user@host:path) are relative to the home folder.
    await run("ssh", ["-o", "BatchMode=yes", ...(r.port ? ["-p", r.port] : []), r.login, `git init --bare --quiet ${shellQuote(r.path)}`]);
  }

  async #remote(): Promise<void> {
    const repo = this.history.repo;
    const current = (await git(repo, ["remote", "get-url", REMOTE]).catch(() => "")).trim();
    if (!current) await git(repo, ["remote", "add", REMOTE, this.url]);
    else if (current !== this.url) await git(repo, ["remote", "set-url", REMOTE, this.url]);
  }

  /** Joins a branch that moved on the remote: a merge commit whose text is this computer's. */
  async #mergeRemote(branch: string): Promise<void> {
    await this.#git(["fetch", "-q", REMOTE, `+refs/heads/${branch}:refs/mirror/${branch}`]);
    await this.#join(branch);
  }

  /** Brings the fetched refs/mirror/<branch> into refs/heads/<branch>; true when that changed it. */
  async #join(branch: string): Promise<boolean> {
    const repo = this.history.repo;
    const remote = (await git(repo, ["rev-parse", `refs/mirror/${branch}`])).trim();
    const local = (await git(repo, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]).catch(() => "")).trim();
    if (!local) {
      // Saved only on another computer so far: take it as it is.
      await git(repo, ["update-ref", `refs/heads/${branch}`, remote, "0".repeat(40)]);
      return true;
    }
    if (local === remote) return false;
    const base = (await git(repo, ["merge-base", local, remote]).catch(() => "")).trim();
    if (base === remote) return false; // we are ahead
    if (base === local) {
      // The remote is simply ahead (saved on another computer): take it, nothing of ours is lost.
      await git(repo, ["update-ref", `refs/heads/${branch}`, remote, local]);
      return true;
    }
    // main on a new computer: only the README commit, unrelated to the remote's: take the remote's.
    if (branch === "main" && !base && !(await git(repo, ["rev-parse", "--verify", "-q", `${local}^`]).catch(() => "")).trim()) {
      await git(repo, ["update-ref", `refs/heads/${branch}`, remote, local]);
      return true;
    }
    const tree = (await git(repo, ["rev-parse", `${local}^{tree}`])).trim();
    const stamp = new Date().toISOString();
    const merge = (await git(repo, ["commit-tree", tree, "-p", local, "-p", remote, "-m", "Join the history saved on another computer"], { env: { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } })).trim();
    await git(repo, ["update-ref", `refs/heads/${branch}`, merge, local]);
    return true;
  }

  async #git(args: string[]): Promise<string> {
    return git(this.history.repo, [...(await this.auth()), ...args]);
  }
}

function shorten(message: string): string {
  const line = message.split("\n").find((l) => /fatal|error|denied|not found|could not/i.test(l)) ?? message.split("\n")[0] ?? message;
  return line.replace(/^git \w+: /, "").replace(/^(fatal|error): /, "").trim();
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (error, stdout, stderr) => (error ? reject(new GitError(`${cmd}: ${stderr.trim() || error.message}`)) : resolve(stdout)));
  });
}
