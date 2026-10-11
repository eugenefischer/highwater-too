import { execFile } from "node:child_process";

export class GitError extends Error {}

/** Runs the system git (so the user's identity, signing setup and credential helpers apply). */
export function git(cwd: string, args: string[], options: { input?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env } }, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        reject(new GitError(missing ? "git is not installed (on a Mac: install the Xcode command-line tools)" : `git ${args[0]}: ${stderr.trim() || error.message}`));
      } else resolve(stdout);
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}
