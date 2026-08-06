1. **Fix `AntigravityParser.ts` `currentMessageId` lifecycle**:
   - Remove `this.currentMessageId = null` from `emitLog`.
   - Update `notifyCommandSent` to explicitly clear `currentMessageId` and `lastEmittedMessage` so that the NEXT message gets a new ID.
   - Remove the `onWorkingStarted` callback that generates a new ID.
2. **Fix `TerminalFSM.ts` `extractLastResponse`**:
   - Rewrite it to reliably find the LAST user prompt and extract everything after it, ignoring whether the idle prompt is present at the bottom (to handle screen tearing).
