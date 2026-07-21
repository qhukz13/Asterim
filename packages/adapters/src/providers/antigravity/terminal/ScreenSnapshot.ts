import { Terminal } from '@xterm/headless';

export interface TerminalSnapshot {
  lines: string[];
  isWrapped: boolean[];
  cursorX: number;
  cursorY: number;
  baseY: number;
}

export function takeSnapshot(term: Terminal): TerminalSnapshot {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  const isWrapped: boolean[] = [];

  // We capture the entire buffer up to the current line where the cursor is.
  // Actually, sometimes the terminal writes below the cursor and then moves up,
  // but typically for CLI it's safe to read up to buffer.baseY + term.rows.
  const endRow = buffer.baseY + term.rows;

  for (let i = 0; i < endRow; i++) {
    const line = buffer.getLine(i);
    if (line) {
      // translateToString(false) preserves trailing whitespaces, which is important
      // if the line wraps to the next one at a space.
      lines.push(line.translateToString(false));
      isWrapped.push(line.isWrapped);
    } else {
      lines.push('');
      isWrapped.push(false);
    }
  }

  // Trim trailing spaces for lines that do not wrap to the next line
  for (let i = 0; i < lines.length; i++) {
    const nextIsWrapped = i + 1 < lines.length ? isWrapped[i + 1] : false;
    if (!nextIsWrapped) {
      lines[i] = lines[i].trimEnd();
    }
  }

  // Trim trailing empty lines at the absolute end to avoid noise,
  // but keep empty lines that are before the cursor.
  let trimIndex = lines.length - 1;
  while (
    trimIndex >= 0 &&
    lines[trimIndex].trim() === '' &&
    trimIndex > buffer.baseY + buffer.cursorY
  ) {
    trimIndex--;
  }

  const finalLines = lines.slice(0, trimIndex + 1);
  const finalIsWrapped = isWrapped.slice(0, trimIndex + 1);

  return {
    lines: finalLines,
    isWrapped: finalIsWrapped,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY
  };
}
