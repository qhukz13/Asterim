'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
function testOverlap() {
  var oldText =
    '\u2584\u2580\u2580\u2584 Antigravity CLI 1.0.11 \u2580\u2580\u2580\u2580\u2580\u2580 v.onashchuk@gmail.com \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580 C:/Projects/AsterimTEST \u2584\u2580\u2580 \u2580\u2580\u2584 \u2584\u2580\u2580 \u2580\u2580\u2584\n\nhi\n\nI will start by listing the contents of the workspace directory to\nunderstand the project structure and see if there are any existing files we\nare working with.';
  // newText simulates scrollback containing oldText TWICE (due to xterm not being cleared)
  var newText =
    '\u2584\u2580\u2580\u2584 Antigravity CLI 1.0.11 \u2580\u2580\u2580\u2580\u2580\u2580 v.onashchuk@gmail.com \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580 C:/Projects/AsterimTEST \u2584\u2580\u2580 \u2580\u2580\u2584 \u2584\u2580\u2580 \u2580\u2580\u2584\n\nhi\n\nI will start by listing the contents of the workspace directory to\nunderstand the project structure and see if there are any existing files we\nare working with.\n\nhi\n\n\u2584\u2580\u2580\u2584 Antigravity CLI 1.0.11 \u2580\u2580\u2580\u2580\u2580\u2580 v.onashchuk@gmail.com \u2580\u2580\u2580\u2580\u2580\u2580\u2580\u2580 C:/Projects/AsterimTEST \u2584\u2580\u2580 \u2580\u2580\u2584 \u2584\u2580\u2580 \u2580\u2580\u2584\n\nhi\n\nI will start by listing the contents of the workspace directory to\nunderstand the project structure and see if there are any existing files we\nare working with.\n\nhi\n\nHere is the answer to your second hi!';
  var oldLines = oldText.split('\n');
  var newLines = newText.split('\n');
  var matchEndIndexInNew = -1;
  var bestK = 0;
  for (var k = oldLines.length; k > 0; k--) {
    var searchBlock = oldLines.slice(oldLines.length - k);
    var blockText = searchBlock.join('').trim();
    if (k < oldLines.length && blockText.length < 15) {
      continue;
    }
    // SEARCH BACKWARDS to find the LAST occurrence in the scrollback!
    for (var i = newLines.length - k; i >= 0; i--) {
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
