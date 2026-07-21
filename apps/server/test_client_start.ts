import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected to server');

  // 1. Join project room
  socket.emit('client.join', { projectId: 'test-new-proj' });

  // 2. Start agent
  setTimeout(() => {
    console.log('Sending start command...');
    socket.emit('client.command', {
      command: 'start',
      agentType: 'antigravity',
      projectId: 'test-new-proj'
    });
  }, 1000);
});

socket.on('agent.status', data => {
  console.log('STATUS:', data);
  if (data.status === 'working') {
    process.exit(0);
  }
  if (data.status === 'error') {
    process.exit(1);
  }
});

socket.on('agent.log', data => {
  console.log('LOG:', data.message);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});
