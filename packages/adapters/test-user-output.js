const text = `> whats in the hello_world.py file?

● ListDir(C:/Projects/AsterimTEST)
● Read(C:/Projects/AsterimTEST/hello_world.py) (ctrl+o to expand)

  The hello_world.py file contains the following code:

    print("Hello, World!")


────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
>
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
? for shortcuts                                                                                Gemini 3.5 Flash (Medium)`;

const matches = [...text.matchAll(/(?:^|\n)[❯>](?:\s*\n|$)/g)];
console.log(
  'MATCHES:',
  matches.map(m => m[0])
);
if (matches.length > 0) {
  const match = matches[matches.length - 1];
  console.log('MATCH INDEX:', match.index);
  console.log('MATCH VALUE:', JSON.stringify(match[0]));
} else {
  console.log('NO MATCH');
}
