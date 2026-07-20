const lines = [
  '## main...origin/main [ahead 1, behind 2]',
  '## main...origin/main [ahead 1]',
  '## main',
  '## feature-branch...origin/feature-branch'
];
const regex = /##\s+([^.\s]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.*)\])?/;
for (const line of lines) {
  const match = line.match(regex);
  console.log(line);
  if (match) {
    console.log(' Branch:', match[1]);
    console.log(' Upstream:', match[2]);
    console.log(' Sync:', match[3]);
  }
}
