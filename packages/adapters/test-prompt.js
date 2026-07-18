'use strict';
var __assign =
  (this && this.__assign) ||
  function () {
    __assign =
      Object.assign ||
      function (t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
      };
    return __assign.apply(this, arguments);
  };
Object.defineProperty(exports, '__esModule', { value: true });
var pty = require('node-pty');
var headless_1 = require('@xterm/headless');
var xterm = new headless_1.Terminal({
  cols: 80,
  rows: 30,
  allowProposedApi: true
});
var ptyProcess = pty.spawn('C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe', [], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: 'C:\\Projects\\Asterim',
  env: __assign(__assign({}, process.env), { FORCE_COLOR: '1' })
});
ptyProcess.onData(function (data) {
  xterm.write(data, function () {
    var screenText = '';
    var buffer = xterm.buffer.active;
    for (var i = 0; i < buffer.length; i++) {
      var line = buffer.getLine(i);
      if (line) {
        screenText += line.translateToString(true) + '\n';
      }
    }
    var lines = screenText.trimEnd().split('\n');
    var lastLines = lines.slice(-3);
    console.log('--- LAST 3 LINES ---');
    console.log(lastLines);
  });
});
setTimeout(function () {
  ptyProcess.kill();
  process.exit(0);
}, 5000);
