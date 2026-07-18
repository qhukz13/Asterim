const { io } = require('socket.io-client');
const crypto = require('crypto');

const projectId = '12cbf0b7-b68b-4f97-b416-76ac263dd3ff'; // the user's project id from logs

const socket = io('http://localhost:3000', {
  auth: { token: '149944' } // Try with/without token if we get unauthorized
});

socket.on('connect', () => {
  console.log('Connected:', socket.id);
  socket.emit('join_project', projectId);

  setTimeout(() => {
    console.log('Sending client.command (start)...');
    socket.emit('client_event', {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: 'client.command',
      source: `remote:${socket.id}`,
      payload: { command: 'start', projectId, agentType: 'antigravity' }
    });

    setTimeout(() => {
      console.log('Sending client.chat_message (hi)...');
      socket.emit('client_event', {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'client.chat_message',
        source: `remote:${socket.id}`,
        payload: { content: 'hi', projectId }
      });
    }, 1500);
  }, 1000);
});

socket.on('connect_error', err => {
  console.error('Connection error:', err.message);
});

socket.onAny((eventName, ...args) => {
  console.log(
    'Received event:',
    eventName,
    args.map(a => a?.type || a?.payload?.status || a)
  );
});

setTimeout(() => process.exit(0), 10000);
