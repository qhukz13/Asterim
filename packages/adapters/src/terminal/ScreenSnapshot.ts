import { Terminal } from '@xterm/headless';

export interface TerminalSnapshot {
  lines: string[];
  cursorX: number;
  cursorY: number;
  baseY: number;
}

export function takeSnapshot(term: Terminal): TerminalSnapshot {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  
  // We capture the entire buffer up to the current line where the cursor is.
  // Actually, sometimes the terminal writes below the cursor and then moves up,
  // but typically for CLI it's safe to read up to buffer.baseY + term.rows.
  const endRow = buffer.baseY + term.rows;
  
  for (let i = 0; i < endRow; i++) {
    const line = buffer.getLine(i);
    if (line) {
      // translateToString(true) trims trailing whitespaces, which is usually what we want for diffing,
      // but if we want EXACT diffs we might want false. For now, true is safer to avoid trailing space noise.
      lines.push(line.translateToString(true));
    } else {
      lines.push('');
    }
  }

  // Trim trailing empty lines at the absolute end to avoid noise,
  // but keep empty lines that are before the cursor.
  let trimIndex = lines.length - 1;
  while (trimIndex >= 0 && lines[trimIndex].trim() === '' && trimIndex > (buffer.baseY + buffer.cursorY)) {
    trimIndex--;
  }
  
  const finalLines = lines.slice(0, trimIndex + 1);

  return {
    lines: finalLines,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY,
  };
}
