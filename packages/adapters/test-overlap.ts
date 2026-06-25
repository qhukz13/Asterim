import * as fs from 'fs';

function testOverlap() {
  const oldText = `I will check the workspace directory to see if there have been any changes
or updates over the last few days.

● ListDir(C:/Projects/AgentDeckTEST) (ctrl+o to expand)

Hello! I see the workspace hasn't changed since our last session.

What would you like to work on today?`;

  const newText = `create file hello_world.pyI will check the workspace directory to see if there have been any changes
or updates over the last few days.

● ListDir(C:/Projects/AgentDeckTEST) (ctrl+o to expand)

Hello! I see the workspace hasn't changed since our last session.

What would you like to work on today?

hi

Hi! How can I help you today?

create file hello_world.py

I will recreate the hello_world.py file as requested.`;

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let matchEndIndexInNew = -1;
  let bestK = 0;

  for (let k = oldLines.length; k > 0; k--) {
    const searchBlock = oldLines.slice(oldLines.length - k);
    const blockText = searchBlock.join('').trim();
    
    // Only accept substantial matches unless it's the exact full history
    if (k < oldLines.length && blockText.length < 15) {
      continue;
    }

    for (let i = 0; i <= newLines.length - k; i++) {
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
