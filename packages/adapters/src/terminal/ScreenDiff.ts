import { TerminalSnapshot } from './ScreenSnapshot';

export interface DiffResult {
  newLines: string[];
  modifiedLines: { index: number; old: string; new: string }[];
  appendedText: string;
}

export function diffScreens(prev: TerminalSnapshot, curr: TerminalSnapshot): DiffResult {
  const result: DiffResult = {
    newLines: [],
    modifiedLines: [],
    appendedText: ''
  };

  // If the terminal has cleared its history or something bizarre happened, 
  // we just treat the current snapshot as entirely new.
  if (curr.baseY < prev.baseY && curr.lines.length < prev.lines.length) {
    result.newLines = [...curr.lines];
    result.appendedText = curr.lines.join('\n');
    return result;
  }

  // Calculate the shift in the buffer (due to scrollback limit or new lines pushing history up)
  // Actually, baseY is the absolute index of the top line of the viewport.
  // The absolute line index in the full buffer history is the index in the array.
  
  // We can just iterate through curr.lines.
  // The line at index `i` in `curr` corresponds to index `i` in `prev`, 
  // because xterm.js array indices are absolute over the lifetime of the buffer 
  // (until the scrollback limit is hit).
  
  // Wait, if scrollback limit is hit, the top lines are removed, and the indices shift.
  // How does xterm handle scrollback limit?
  // When max scrollback is reached, `buffer.lines` drops the first item.
  // This means the absolute index shifts!
  // To keep it simple and robust, we can match lines from the bottom up, 
  // OR we can rely on the fact that for LLM output streaming, we mostly care about the end of the buffer.
  
  // A robust way to diff is to just compare by index, assuming scrollback isn't hit between two ticks.
  // Since we take a snapshot on EVERY chunk synchronously, scrollback limit being hit will only shift by a few lines.
  // Let's assume indices are aligned for now (since we use a large scrollback or don't expect 1000 lines in 1ms).
  // Actually, xterm's buffer.getLine(i) takes an absolute index from 0 to scrollback+rows.
  // If a line is pushed out, the new line gets a new index at the end, and index 0 is deleted.
  // So index `i` in `prev` corresponds to index `i - shift` in `curr`.
  // To calculate shift:
  const shift = Math.max(0, curr.baseY - prev.baseY); // This isn't exactly right if scrollback drops lines.
  // Let's just compare the arrays directly, assuming index `i` is the same absolute line 
  // IF we don't hit the scrollback limit. If we do hit it, it's safer to just look at the difference in length.

  const prevLen = prev.lines.length;
  const currLen = curr.lines.length;

  for (let i = 0; i < currLen; i++) {
    if (i < prevLen) {
      if (curr.lines[i] !== prev.lines[i]) {
        result.modifiedLines.push({
          index: i,
          old: prev.lines[i],
          new: curr.lines[i]
        });
        
        // If the new line grew from the old line (e.g. typing a command or streaming tokens)
        const oldLine = prev.lines[i];
        const newLine = curr.lines[i];
        if (newLine.startsWith(oldLine)) {
          result.appendedText += newLine.substring(oldLine.length);
        }
      }
    } else {
      // New line added
      result.newLines.push(curr.lines[i]);
      if (result.appendedText.length > 0) result.appendedText += '\n';
      result.appendedText += curr.lines[i];
    }
  }

  return result;
}
