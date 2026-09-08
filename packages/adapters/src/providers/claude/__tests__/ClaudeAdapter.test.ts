/**
 * Claude Code adapter: stream-json protocol → Asterim events, and the host
 * side of the permission control protocol.
 *
 * No Claude Code process is started. `feedStdout` is fed the exact line shapes
 * the CLI writes in `--output-format stream-json` mode; `writeRaw` is captured
 * so what would have gone to the CLI's stdin can be asserted. The launch
 * command is checked separately for the flags that make the integration safe.
 *
 * Run:  pnpm --filter @asterim/adapters exec tsx src/providers/claude/__tests__/ClaudeAdapter.test.ts
 */

import assert from 'assert';
import { ClaudeAdapter, describeToolCall } from '../ClaudeAdapter';
import type { AsterimEvent } from '@asterim/shared';
import type { NativePermissionAsk } from '../../../sdk/types';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} — ${(err as Error).message}`);
  }
}

/** The adapter with stdin captured instead of written to a process. */
class CapturingAdapter extends ClaudeAdapter {
  public lines: string[] = [];
  protected writeRaw(line: string): boolean {
    this.lines.push(line);
    return true;
  }
  public setResolver(fn: (ask: NativePermissionAsk) => Promise<{ approved: boolean; message?: string }>) {
    (this as any).permissionResolver = fn;
  }
}

function collect(adapter: ClaudeAdapter): AsterimEvent[] {
  const events: AsterimEvent[] = [];
  adapter.getEventBus().subscribe(e => events.push(e));
  return events;
}

const line = (obj: unknown) => JSON.stringify(obj) + '\n';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function main() {
  // --- Output protocol --------------------------------------------------------
  {
    const adapter = new CapturingAdapter('thread-1');
    const events = collect(adapter);

    adapter.feedStdout(
      line({ type: 'system', subtype: 'init', session_id: 'sess-abc', model: 'claude-sonnet-5', tools: ['Bash', 'Read'] })
    );

    check('system/init publishes the provider session id', () => {
      const session = events.find(e => e.type === 'agent.session');
      assert.ok(session, 'agent.session event');
      assert.strictEqual(session!.payload.providerSessionId, 'sess-abc');
      assert.strictEqual(session!.payload.model, 'claude-sonnet-5');
    });

    const streamLine = line({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }
    });
    adapter.feedStdout(streamLine.slice(0, 20));
    adapter.feedStdout(streamLine.slice(20));
    adapter.feedStdout(
      line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } } })
    );

    check('text deltas stream the accumulated text, reassembling split lines', () => {
      const streams = events.filter(e => e.type === 'agent.stream');
      assert.strictEqual(streams.length, 2);
      assert.strictEqual(streams[1].payload.content, 'Hello world');
      assert.strictEqual(streams[0].id, streams[1].id, 'same message id across deltas');
    });

    adapter.feedStdout(
      line({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello world' },
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la', description: 'List files' } }
          ]
        }
      })
    );

    check('an assistant message becomes one chat message with the streamed id', () => {
      const chat = events.filter(e => e.type === 'chat.message');
      assert.strictEqual(chat.length, 1);
      assert.strictEqual(chat[0].payload.role, 'agent');
      assert.strictEqual(chat[0].payload.content, 'Hello world');
      assert.strictEqual(chat[0].id, events.find(e => e.type === 'agent.stream')!.id);
    });

    check('a tool_use block becomes agent.tool_call and a readable log line', () => {
      const call = events.find(e => e.type === 'agent.tool_call');
      assert.ok(call);
      assert.strictEqual(call!.payload.tool, 'Bash');
      assert.deepStrictEqual(call!.payload.arguments, { command: 'ls -la', description: 'List files' });
      assert.ok(events.filter(e => e.type === 'agent.log').some(e => String(e.payload.message).includes('ls -la')));
    });

    adapter.feedStdout(
      line({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'total 0', is_error: false }] }
      })
    );

    check('a tool_result is labelled with the tool that produced it', () => {
      const result = events.find(e => e.type === 'agent.tool_result');
      assert.ok(result);
      assert.strictEqual(result!.payload.tool, 'Bash');
      assert.strictEqual(result!.payload.text, 'total 0');
      assert.strictEqual(result!.payload.isError, false);
    });

    adapter.feedStdout(
      line({ type: 'assistant', parent_tool_use_id: 'toolu_sub', message: { role: 'assistant', content: [{ type: 'text', text: 'subagent chatter' }] } })
    );

    check('subagent messages do not reach the transcript', () => {
      assert.strictEqual(events.filter(e => e.type === 'chat.message').length, 1);
    });

    adapter.feedStdout(line({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, duration_ms: 4000 }));

    check('a result returns the adapter to idle with cost in the message', () => {
      const status = events.filter(e => e.type === 'agent.status').pop();
      assert.strictEqual(status?.payload.status, 'idle');
      assert.ok(String(status?.payload.message).includes('$0.012'));
    });

    adapter.feedStdout(line({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' }));

    check('an error result is surfaced as an error status', () => {
      const status = events.filter(e => e.type === 'agent.status').pop();
      assert.strictEqual(status?.payload.status, 'error');
      assert.ok(String(status?.payload.message).includes('boom'));
    });

    adapter.feedStdout('not json at all\n');

    check('a non-JSON line is logged rather than thrown', () => {
      assert.strictEqual(events.filter(e => e.type === 'agent.log').pop()?.payload.message, 'not json at all');
    });
  }

  // --- Permission control protocol -------------------------------------------
  {
    const adapter = new CapturingAdapter('thread-2');
    const asks: NativePermissionAsk[] = [];
    adapter.setResolver(async ask => {
      asks.push(ask);
      return ask.toolName === 'Write' ? { approved: true } : { approved: false, message: 'Nope.' };
    });

    adapter.feedStdout(
      line({
        type: 'control_request',
        request_id: 'req-1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'Write',
          input: { file_path: 'a.txt', content: 'hello' },
          tool_use_id: 'toolu_9',
          description: 'Create a.txt',
          decision_reason: 'Write is not in the allow list'
        }
      })
    );
    await tick();

    check('a can_use_tool request reaches the resolver with the tool, input and reason', () => {
      assert.strictEqual(asks.length, 1);
      assert.strictEqual(asks[0].toolName, 'Write');
      assert.deepStrictEqual(asks[0].input, { file_path: 'a.txt', content: 'hello' });
      assert.strictEqual(asks[0].description, 'Create a.txt');
      assert.strictEqual(asks[0].reason, 'Write is not in the allow list');
    });

    check('an approval is answered with allow and the unchanged input', () => {
      const reply = JSON.parse(adapter.lines[adapter.lines.length - 1]);
      assert.strictEqual(reply.type, 'control_response');
      assert.strictEqual(reply.response.subtype, 'success');
      assert.strictEqual(reply.response.request_id, 'req-1');
      assert.strictEqual(reply.response.response.behavior, 'allow');
      assert.deepStrictEqual(reply.response.response.updatedInput, { file_path: 'a.txt', content: 'hello' });
    });

    adapter.feedStdout(
      line({ type: 'control_request', request_id: 'req-2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'rm -rf /' } } })
    );
    await tick();

    check('a denial is answered with deny and the message', () => {
      const reply = JSON.parse(adapter.lines[adapter.lines.length - 1]);
      assert.strictEqual(reply.response.request_id, 'req-2');
      assert.strictEqual(reply.response.response.behavior, 'deny');
      assert.strictEqual(reply.response.response.message, 'Nope.');
    });

    adapter.feedStdout(line({ type: 'control_request', request_id: 'req-3', request: { subtype: 'request_user_dialog' } }));
    await tick();

    check('an unsupported control request is refused with an error response', () => {
      const reply = JSON.parse(adapter.lines[adapter.lines.length - 1]);
      assert.strictEqual(reply.response.subtype, 'error');
      assert.strictEqual(reply.response.request_id, 'req-3');
    });

    // The CLI withdraws a request while the human is still deciding.
    const slow = new CapturingAdapter('thread-2b');
    let seenSignal: AbortSignal | undefined;
    let release: (v: { approved: boolean }) => void = () => undefined;
    slow.setResolver(ask => {
      seenSignal = ask.signal;
      return new Promise(resolve => {
        release = resolve;
      });
    });
    slow.feedStdout(
      line({ type: 'control_request', request_id: 'req-5', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'b.txt' } } })
    );
    await tick();
    const before = slow.lines.length;
    slow.feedStdout(line({ type: 'control_cancel_request', request_id: 'req-5' }));
    await tick();
    release({ approved: true });
    await tick();

    check('a control_cancel_request aborts the pending ask and no answer is sent', () => {
      assert.ok(seenSignal, 'resolver received a signal');
      assert.strictEqual(seenSignal!.aborted, true);
      assert.strictEqual(slow.lines.length, before, 'no control_response written after the cancel');
    });

    const noResolver = new CapturingAdapter('thread-3');
    noResolver.feedStdout(
      line({ type: 'control_request', request_id: 'req-4', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } })
    );
    await tick();

    check('with no resolver every permission request is denied', () => {
      const reply = JSON.parse(noResolver.lines[noResolver.lines.length - 1]);
      assert.strictEqual(reply.response.response.behavior, 'deny');
    });
  }

  // --- Launch command ---------------------------------------------------------
  {
    const adapter = new CapturingAdapter('thread-4');
    let launch: { cmd: string; args: string[] } | null = null;
    let error: Error | null = null;
    try {
      launch = adapter.getLaunchCommand({
        workspace: process.cwd(),
        resumeSessionId: 'sess-abc',
        permissionResolver: async () => ({ approved: false })
      });
    } catch (err) {
      error = err as Error;
    }

    if (error) {
      check('a missing binary produces an actionable error', () => {
        assert.ok(error!.message.includes('Claude Code is not installed'));
      });
    } else {
      check('the launch never skips permissions', () => {
        assert.ok(!launch!.args.includes('--dangerously-skip-permissions'));
        assert.ok(!launch!.args.includes('bypassPermissions'));
      });
      check('the launch uses the streaming protocol in print mode', () => {
        assert.ok(launch!.args.includes('-p'));
        assert.ok(launch!.args.includes('--input-format'));
        assert.ok(launch!.args.includes('stream-json'));
        assert.ok(launch!.args.includes('--output-format'));
      });
      check('with a resolver the CLI is told to ask the stdio host for permissions', () => {
        const i = launch!.args.indexOf('--permission-prompt-tool');
        assert.ok(i >= 0 && launch!.args[i + 1] === 'stdio');
      });
      check('without a resolver the flag is absent and the CLI denies on its own', () => {
        const bare = new CapturingAdapter('thread-5').getLaunchCommand({ workspace: process.cwd() });
        assert.ok(!bare.args.includes('--permission-prompt-tool'));
      });
      check('the launch resumes the remembered session', () => {
        const i = launch!.args.indexOf('--resume');
        assert.ok(i >= 0 && launch!.args[i + 1] === 'sess-abc');
      });
    }
  }

  // --- Descriptions -------------------------------------------------------------
  check('describeToolCall names the command for shell tools', () => {
    assert.strictEqual(describeToolCall('Bash', { command: 'git status' }), 'Bash: git status');
  });
  check('describeToolCall names the file for edit tools', () => {
    assert.strictEqual(describeToolCall('Edit', { file_path: 'src/a.ts' }), 'Edit: src/a.ts');
  });
  check('describeToolCall falls back to serialised input', () => {
    assert.ok(describeToolCall('mcp__x__y', { q: 1 }).startsWith('mcp__x__y {"q":1}'));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
