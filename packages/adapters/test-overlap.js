'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
function testOverlap() {
  var oldText =
    "I will check the workspace directory to see if there have been any changes\nor updates over the last few days.\n\n\u25CF ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)\n\nHello! I see the workspace hasn't changed since our last session.\n\nWhat would you like to work on today?";
  var newText =
    "create file hello_world.pyI will check the workspace directory to see if there have been any changes\nor updates over the last few days.\n\n\u25CF ListDir(C:/Projects/AsterimTEST) (ctrl+o to expand)\n\nHello! I see the workspace hasn't changed since our last session.\n\nWhat would you like to work on today?\n\nhi\n\nHi! How can I help you today?\n\ncreate file hello_world.py\n\nI will recreate the hello_world.py file as requested.";
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
