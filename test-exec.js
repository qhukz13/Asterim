const { execFile } = require('child_process');
execFile('agy', ['-p', 'what is 2+2, answer only with the number'], (err, stdout, stderr) => {
  if (err) console.error("ERR:", err);
  console.log("STDOUT:", stdout);
  console.log("STDERR:", stderr);
});
