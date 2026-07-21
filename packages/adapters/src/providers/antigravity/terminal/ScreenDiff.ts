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

  const isNoise = (line: string) => {
    if (line.match(/esc to cancel/i)) return true;
    if (line.match(/\? for shortcuts/i)) return true;
    if (line.match(/Gemini \d+\.\d+ Flash/i)) return true;
    if (line.match(/Navigate.*?(enter|esc)/i)) return true;
    if (line.match(/(Working|Generating|Running|Thinking)(\.\.\.|…)/i)) return true;
    if (line.match(/^[^\w\s]*\s*(Working|Generating|Running|Thinking)(\.\.\.|…)/i)) return true;
    return false;
  };

  const prevClean = prev.lines.filter(l => !isNoise(l));
  const currClean = curr.lines.filter(l => !isNoise(l));

  if (prevClean.length === 0) {
    result.appendedText = currClean.join('\n');
    return result;
  }

  // Robust Anchor-Search Algorithm
  // Find the occurrence of the last line of `prevClean` inside `currClean`
  // that yields the longest contiguous backward match.
  let bestMatchCount = -1;
  let bestC = -1;

  const lastPrevLine = prevClean[prevClean.length - 1];

  for (let c = 0; c < currClean.length; c++) {
    // Check if currClean[c] could be the continuation/match of lastPrevLine
    if (currClean[c].startsWith(lastPrevLine)) {
      let matchCount = 1;
      let p = prevClean.length - 2;
      let tempC = c - 1;

      // Verify backwards
      while (p >= 0 && tempC >= 0 && prevClean[p] === currClean[tempC]) {
        matchCount++;
        p--;
        tempC--;
      }

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestC = c;
      }
    }
  }

  const appendedParts: string[] = [];

  if (bestC !== -1) {
    // Found the anchor!
    const suffixStr = currClean[bestC].substring(lastPrevLine.length);
    if (suffixStr.length > 0) {
      appendedParts.push(suffixStr);
    }
    // Everything after the anchor is new text
    for (let i = bestC + 1; i < currClean.length; i++) {
      appendedParts.push(currClean[i]);
    }
  } else {
    // If the last line of prevClean is completely gone, the screen changed fundamentally.
    // We just dump the new screen.
    appendedParts.push(...currClean);
  }

  result.appendedText = appendedParts.join('\n');
  return result;
}
