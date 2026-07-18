import { AntigravityAdapter } from './src/AntigravityAdapter';
const adapter = new AntigravityAdapter();
adapter.onEvent(e => console.log('EVENT:', e));
adapter
  .start({
    workspace: process.cwd(),
    requestApproval: async () => true,
    requestQuestion: async () => 1,
    onExit: code => console.log('EXIT:', code)
  })
  .then(() => {
    console.log('Started');
    setTimeout(() => {
      console.log('Sending message...');
      adapter.sendCommand('hello');
    }, 4000);
  })
  .catch(console.error);
