'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
function testOverlap() {
  var oldText =
    '\u2584\u2580\u2580\u2584 Antigravity CLI 1.0.11 \u2580\u2580\u2580\u2580\u2580\u2580 v.onashchuk@gmail.com \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580 C:/Projects/AsterimTEST \u2584\u2580\u2580 \u2580\u2580\u2584 \u2584\u2580\u2580 \u2580\u2580\u2584\n\nhi\n\nI will start by listing the contents of the workspace directory to\nunderstand the project structure and see if there are any existing files we\nare working with.\n\n\u25CF ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)\n\nHello! I see we are in a fresh workspace at AsterimTEST.\n\nHow can I help you today? Let me know if you would like to start a new\nproject, write some code, or if you have any questions!\n\ncreate a file hello_world.py\n\nI will create the hello_world.py file in the workspace with a simple hello\nworld script.\n\n\u25CF Create(C:/Projects/AsterimTEST/hello_world.py) (ctrl+o to expand)\n\nI will run the script to verify that it executes correctly.\n\n\u25CF Bash(python hello_world.py) (ctrl+o to expand)\n\nI have successfully created and run the file.\n\nSummary of Changes:\nCreated hello_world.py containing:\nprint("Hello, World!")\n\nRan the script via command line, which returned:\nHello, World!';
  var newText =
    'hi\n\n\u2584\u2580\u2580\u2584 Antigravity CLI 1.0.11 \u2580\u2580\u2580\u2580\u2580\u2580 v.onashchuk@gmail.com \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580 C:/Projects/AsterimTEST \u2584\u2580\u2580 \u2580\u2580\u2584 \u2584\u2580\u2580 \u2580\u2580\u2584\n\nhi\n\nI will start by listing the contents of the workspace directory to\nunderstand the project structure and see if there are any existing files we\nare working with.\n\n\u25CF ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)\n\nHello! I see we are in a fresh workspace at AsterimTEST.\n\nHow can I help you today? Let me know if you would like to start a new\nproject, write some code, or if you have any questions!\n\ncreate a file hello_world.py\n\nI will create the hello_world.py file in the workspace with a simple hello\nworld script.\n\n\u25CF Create(C:/Projects/AsterimTEST/hello_world.py) (ctrl+o to expand)\n\nI will run the script to verify that it executes correctly.\n\n\u25CF Bash(python hello_world.py) (ctrl+o to expand)\n\nI have successfully created and run the file.\n\nSummary of Changes:\nCreated hello_world.py containing:\nprint("Hello, World!")\n\nRan the script via command line, which returned:\nHello, World!\n\nhi\n\nI will list the workspace directory contents to see if there have been any\nchanges since our last interaction.\n\n\u25CF ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)\n\nI will check the contents of the newly created test_out.txt to see what\nit contains.\n\n\u25CF Read(C:/Projects/AsterimTEST/test_out.txt) (ctrl+o to expand)\n\nHello! I see we currently have the following files in the workspace:\n\n\u2022 hello_world.py (our Hello World script)\n\u2022 test_out.txt (currently empty)\n\nWhat would you like to build or work on next?';
  var oldLines = oldText.split('\n');
  var newLines = newText.split('\n');
  var matchEndIndexInNew = -1;
  var bestK = 0;
  for (var k = oldLines.length; k > 0; k--) {
    var searchBlock = oldLines.slice(oldLines.length - k);
    var blockText = searchBlock.join('').trim();
    // Only accept substantial matches unless it's the exact full history
    if (k < oldLines.length && blockText.length < 15) {
      continue;
    }
    for (var i = 0; i <= newLines.length - k; i++) {
      var match = true;
      for (var j = 0; j < k; j++) {
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
  var result = newText;
  if (bestK > 0) {
    result = newLines.slice(matchEndIndexInNew).join('\n').trim();
  }
  console.log('BEST K:', bestK);
  console.log('MATCH END INDEX:', matchEndIndexInNew);
  console.log('=== NEW RESULT ===');
  console.log(result);
}
testOverlap();
