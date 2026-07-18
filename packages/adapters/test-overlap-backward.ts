import * as fs from 'fs';

function testOverlap() {
  const oldText = `▄▀▀▄ Antigravity CLI 1.0.11 ▀▀▀▀▀▀ v.onashchuk@gmail.com ▀▀▀▀▀▀▀▀ C:/Projects/AsterimTEST ▄▀▀ ▀▀▄ ▄▀▀ ▀▀▄

hi

I will start by listing the contents of the workspace directory to
understand the project structure and see if there are any existing files we
are working with.`;

  // newText simulates scrollback containing oldText TWICE (due to xterm not being cleared)
  const newText = `▄▀▀▄ Antigravity CLI 1.0.11 ▀▀▀▀▀▀ v.onashchuk@gmail.com ▀▀▀▀▀▀▀▀ C:/Projects/AsterimTEST ▄▀▀ ▀▀▄ ▄▀▀ ▀▀▄

hi

I will start by listing the contents of the workspace directory to
understand the project structure and see if there are any existing files we
are working with.

hi

▄▀▀▄ Antigravity CLI 1.0.11 ▀▀▀▀▀▀ v.onashchuk@gmail.com ▀▀▀▀▀▀▀▀ C:/Projects/AsterimTEST ▄▀▀ ▀▀▄ ▄▀▀ ▀▀▄

hi

I will start by listing the contents of the workspace directory to
understand the project structure and see if there are any existing files we
are working with.

hi

Here is the answer to your second hi!`;

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let matchEndIndexInNew = -1;
  let bestK = 0;

  for (let k = oldLines.length; k > 0; k--) {
    const searchBlock = oldLines.slice(oldLines.length - k);
    const blockText = searchBlock.join('').trim();
    
    if (k < oldLines.length && blockText.length < 15) {
      continue;
    }

    // SEARCH BACKWARDS to find the LAST occurrence in the scrollback!
    for (let i = newLines.length - k; i >= 0; i--) {
      let match = true;
      for (let j = 0; j < k; j++) {
        if (newLines[i + j] !== searchBlock[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        bestK = k;
        matchEndIndexInNew = i + k;
        break;
      }
    }
    if (bestK > 0) break;
  }

  let result = newText;
  if (bestK > 0) {
    result = newLines.slice(matchEndIndexInNew).join('\n').trim();
  }

  console.log("BEST K:", bestK);
  console.log("MATCH END INDEX:", matchEndIndexInNew);
  console.log("=== NEW RESULT ===");
  console.log(result);
}

testOverlap();
