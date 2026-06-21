const pty = require('node-pty');
const agyPath = 'C:\\Users\\qhukz\\AppData\\Local\\agy\\bin\\agy.exe';
console.log("Testing -c");
const ptyC = pty.spawn(agyPath, ['-c'], { cwd: process.cwd() });
ptyC.onData(data => console.log("C-DATA:", data));
ptyC.onExit(({exitCode}) => {
  console.log("C-EXIT:", exitCode);
  console.log("Testing -i");
  const ptyI = pty.spawn(agyPath, ['-i'], { cwd: process.cwd() });
  ptyI.onData(data => console.log("I-DATA:", data));
  ptyI.onExit(({exitCode}) => {
    console.log("I-EXIT:", exitCode);
  });
});
