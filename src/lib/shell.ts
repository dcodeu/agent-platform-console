import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
  ms: number;
}

export async function run(
  cmd: string,
  args: string[] = [],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<ShellResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      timeout: opts.timeoutMs ?? 8000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...opts.env },
    });
    return {
      stdout: String(stdout),
      stderr: String(stderr),
      code: 0,
      ok: true,
      ms: Date.now() - start,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string; code?: number };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? e.message ?? ""),
      code: typeof e.code === "number" ? e.code : 1,
      ok: false,
      ms: Date.now() - start,
    };
  }
}
