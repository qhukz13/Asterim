const text = `
Here is some history.
And the user wrote:
>
This is blockquote.

And here is the actual prompt:
>
────────────────────────────────────────────────────────────────────────────────
? for shortcuts                                        Gemini 3.5 Flash (Medium)`;

const matches = [...text.matchAll(/(?:^|\n)[❯>](?:\s*\n|$)/g)];
if (matches.length > 0) {
  const match = matches[matches.length - 1];
  console.log("MATCH INDEX:", match.index);
  console.log("MATCH VALUE:", JSON.stringify(match[0]));
  
  const message = text.substring(0, match.index);
  console.log("MESSAGE:");
  console.log(message);
} else {
  console.log("NO MATCH");
}
