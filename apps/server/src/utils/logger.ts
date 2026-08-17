import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './channel';

let originalStdoutWrite: any = null;

/**
 * Strips known secret values out of everything on its way to the log file.
 *
 * Installed by `SecretVaultService` (P9-01) rather than imported here: this
 * module is the first thing `index.ts` loads, and reaching for the vault from
 * it would pull the database open before the streams have been redirected.
 * Until the vault registers itself, and in any process that never constructs
 * one, this stays the identity function and costs nothing.
 */
let redactor: ((text: string) => string) | null = null;

export function registerLogRedactor(fn: (text: string) => string): void {
  redactor = fn;
}

/** Test seam: drops the installed redactor. */
export function clearLogRedactor(): void {
  redactor = null;
}

/**
 * Applies the redactor to a stream chunk. Buffers are decoded as UTF-8 because
 * that is what everything writing to these streams produces; a chunk that fails
 * to round-trip is passed through untouched rather than corrupted.
 */
export function redactChunk(chunk: any): any {
  if (!redactor) return chunk;
  try {
    if (typeof chunk === 'string') return redactor(chunk);
    if (Buffer.isBuffer(chunk)) {
      const text = chunk.toString('utf8');
      const redacted = redactor(text);
      return redacted === text ? chunk : Buffer.from(redacted, 'utf8');
    }
  } catch {
    /* Redaction must never be the reason a line fails to be logged. */
  }
  return chunk;
}

export function initLogger() {
  // The channel's own directory (DEC-029). A development run writing its console
  // output into `~/.asterim/server.log` would both truncate the stable Core's
  // log on startup and leave the operator reading the wrong process's output.
  const logDir = resolveDataDir();
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
  const logFile = path.join(logDir, 'server.log');

  // Truncate the file on startup
  fs.writeFileSync(logFile, '');
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Redirect stdout
  (process.stdout as any).write = (chunk: any, encoding: any, cb: any) => {
    logStream.write(
      redactChunk(chunk),
      typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
      typeof encoding === 'function' ? encoding : cb
    );
    return true;
  };

  // Redirect stderr
  (process.stderr as any).write = (chunk: any, encoding: any, cb: any) => {
    logStream.write(
      redactChunk(chunk),
      typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
      typeof encoding === 'function' ? encoding : cb
    );
    return true;
  };
}

export function printToConsole(msg: string) {
  if (originalStdoutWrite) {
    originalStdoutWrite(msg + '\n');
  } else {
    // Fallback if logger not initialized yet
    process.stdout.write(msg + '\n');
  }
}
