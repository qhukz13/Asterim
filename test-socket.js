const { io } = require('socket.io-client');
const crypto = require('crypto');

const socket = io('http://localhost:3000', {
  auth: { token: 'mock-token' } // might need real token, but we can bypass auth for local if it's relaxed or grab token.
});

// the server allows origin * but uses pairingService. Let's see if we can bypass it or grab a token.
