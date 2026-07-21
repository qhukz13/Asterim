import fs from 'fs';
import path from 'path';
import os from 'os';

let originalStdoutWrite: any = null;

export function initLogger() {
  const logDir = path.join(os.homedir(), '.asterim');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
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
      chunk,
      typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
      typeof encoding === 'function' ? encoding : cb
    );
    return true;
  };

  // Redirect stderr
  (process.stderr as any).write = (chunk: any, encoding: any, cb: any) => {
    logStream.write(
      chunk,
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
