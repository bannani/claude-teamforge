// Stands in for the `copilot` binary: prints the JSONL named by argv[2].
const line = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const mode = process.argv[2];
if (mode === 'hang') {
  line({ type: 'assistant.message_delta', data: { deltaContent: 'thinking' } });
  setInterval(() => {}, 1000);
} else if (mode === 'fail') {
  process.stderr.write('boom: not signed in\n');
  process.exit(3);
} else {
  process.stdout.write('not json at all\n');
  line({ type: 'session.tools_updated', data: {} });
  line({ type: 'assistant.message_delta', data: { deltaContent: 'Hel' } });
  line({ type: 'assistant.message_delta', data: { deltaContent: 'lo' } });
  line({ type: 'assistant.message', data: { content: 'Hello', toolRequests: [] } });
  line({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'bash', arguments: { command: 'npm test' } } });
  line({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: false, error: { code: 'denied', message: 'Permission denied' } } });
  line({ type: 'tool.execution_start', data: { toolCallId: 't2', toolName: 'create', arguments: { path: '/p/docs/spec.md', file_text: 'x' } } });
  line({ type: 'tool.execution_complete', data: { toolCallId: 't2', success: true, result: { content: 'ok' } } });
  line({ type: 'result', exitCode: 0, sessionId: 's' });
}
