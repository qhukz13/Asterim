const ansiRegex = /[\u001b\u009b][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[a-zA-Z=><~]))/g;
const stripAnsiPackageRegex = new RegExp([
	'[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
	'(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
].join('|'), 'g');

const buf = Buffer.from('1b5b3120711b5b33383b323b3233383b3233323b3231336d', 'hex');
console.log('Original Hex:', buf.toString('hex'));
console.log('Original Str:', JSON.stringify(buf.toString()));

console.log('My Regex    :', Buffer.from(buf.toString().replace(ansiRegex, '')).toString('hex'));
console.log('StripAnsiPkg:', Buffer.from(buf.toString().replace(stripAnsiPackageRegex, '')).toString('hex'));
