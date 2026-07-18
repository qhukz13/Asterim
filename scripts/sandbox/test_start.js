require('ts-node').register({ transpileOnly: true });
const { agentService } = require('./apps/server/src/services/AgentService');
const { eventBus } = require('./apps/server/src/services/EventBus');

eventBus.subscribe('client.command', (event) => {
  console.log("EVENTBUS RECEIVED:", event);
});
eventBus.subscribe('agent.status', (event) => {
  console.log("AGENT STATUS EVENT:", event);
});

async function test() {
  console.log("Starting agent...");
  // Simulate starting agent for a fake project
  await agentService.startAgent('fake-id', 'C:\\Projects\\Asterim', 'antigravity');
}
test().catch(console.error);
