import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

export interface RunProcessOptions {
  input?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function runProcess(command: string, args: readonly string[], options: RunProcessOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 10000;
    const maxOutputBytes = options.maxOutputBytes ?? 16 * 1024 * 1024;
    const label = path.basename(command);

    let child: ChildProcess;
    try {
      child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    };

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may have exited already.
      }
      finish(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > maxOutputBytes) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore kill failures.
        }
        finish(new Error(`${label} produced more than ${maxOutputBytes} bytes of output`));
        return;
      }
      stdout += chunk;
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 8192) {
        stderr += chunk;
      }
    });

    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 800)}` : '';
      finish(new Error(`${label} exited with ${code ?? signal ?? 'an unknown status'}${detail}`));
    });

    child.stdin?.on('error', () => {
      // Broken pipes from short-lived tools are reported through exit status.
    });
    child.stdin?.end(options.input ?? '');
  });
}
