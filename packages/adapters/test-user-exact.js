const text = `>
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
? for shortcuts                                                                                Gemini 3.5 Flash (Medium)`;
const matches = [...text.matchAll(/(?:^|\n)[❯>](?:\s*\n|$)/g)];
console.log(matches.length);
