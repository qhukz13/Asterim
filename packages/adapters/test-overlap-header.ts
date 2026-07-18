import * as fs from 'fs';

function testOverlap() {
  const oldText = `▄▀▀▄ Antigravity CLI 1.0.11 ▀▀▀▀▀▀ v.onashchuk@gmail.com ▀▀▀▀▀▀▀▀ C:/Projects/AsterimTEST ▄▀▀ ▀▀▄ ▄▀▀ ▀▀▄

hi

I will start by listing the contents of the workspace directory to
understand the project structure and see if there are any existing files we
are working with.

● ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)

Hello! I see we are in a fresh workspace at AsterimTEST.

How can I help you today? Let me know if you would like to start a new
project, write some code, or if you have any questions!

create a file hello_world.py

I will create the hello_world.py file in the workspace with a simple hello
world script.

● Create(C:/Projects/AsterimTEST/hello_world.py) (ctrl+o to expand)

I will run the script to verify that it executes correctly.

● Bash(python hello_world.py) (ctrl+o to expand)

I have successfully created and run the file.

Summary of Changes:
Created hello_world.py containing:
print("Hello, World!")

Ran the script via command line, which returned:
Hello, World!`;

  const newText = `hi

▄▀▀▄ Antigravity CLI 1.0.11 ▀▀▀▀▀▀ v.onashchuk@gmail.com ▀▀▀▀▀▀▀▀ C:/Projects/AsterimTEST ▄▀▀ ▀▀▄ ▄▀▀ ▀▀▄

hi

I will start by listing the contents of the workspace directory to
understand the project structure and see if there are any existing files we
are working with.

● ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)

Hello! I see we are in a fresh workspace at AsterimTEST.

How can I help you today? Let me know if you would like to start a new
project, write some code, or if you have any questions!

create a file hello_world.py

I will create the hello_world.py file in the workspace with a simple hello
world script.

● Create(C:/Projects/AsterimTEST/hello_world.py) (ctrl+o to expand)

I will run the script to verify that it executes correctly.

● Bash(python hello_world.py) (ctrl+o to expand)

I have successfully created and run the file.

Summary of Changes:
Created hello_world.py containing:
print("Hello, World!")

Ran the script via command line, which returned:
Hello, World!

hi

I will list the workspace directory contents to see if there have been any
changes since our last interaction.

● ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)

I will check the contents of the newly created test_out.txt to see what
it contains.

● Read(C:/Projects/AsterimTEST/test_out.txt) (ctrl+o to expand)

Hello! I see we currently have the following files in the workspace:

• hello_world.py (our Hello World script)
• test_out.txt (currently empty)

What would you like to build or work on next?`;

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
