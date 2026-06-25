import { AntigravityAdapter } from './src/AntigravityAdapter';

async function test() {
  const adapter = new AntigravityAdapter();
  
  adapter.onEvent((event) => {
    console.log("EVENT:", event.type, event.payload);
  });

  await adapter.start({
    workspace: 'C:\\Projects\\AgentDeck',
    requestApproval: async () => true,
    onExit: async (code) => console.log("EXIT:", code)
  });

  setTimeout(() => {
    console.log("Sending hi...");
    adapter.sendCommand('hi');
  }, 2000);
}

test().catch(console.error);
