import { agentService } from './src/services/AgentService';
import { eventBus } from './src/services/EventBus';

eventBus.subscribe('agent.status', event => {
  console.log('AGENT STATUS:', event.payload);
});
eventBus.subscribe('agent.log', event => {
  console.log('AGENT LOG:', event.payload);
});

async function main() {
  console.log('Starting agent...');
  await agentService.startAgent('fake-id', 'C:\\Projects\\AsterimTEST', 'antigravity');
}
main().catch(console.error);
