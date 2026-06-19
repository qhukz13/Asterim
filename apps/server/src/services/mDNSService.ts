import Bonjour from 'bonjour-service';

export class MDNSService {
  private bonjour: Bonjour | null = null;
  private service: any = null;

  public start(port: number) {
    try {
      this.bonjour = new Bonjour();
      this.service = this.bonjour.publish({
        name: 'AgentDeck Server',
        type: 'http',
        port: port,
        txt: { service: 'agentdeck' }
      });

      console.log(`[mDNS] Publishing AgentDeck service on port ${port}`);
    } catch (err) {
      console.error('[mDNS] Failed to start mDNS service:', err);
    }
  }

  public stop() {
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
    console.log('[mDNS] Stopped mDNS service');
  }
}

export const mdnsService = new MDNSService();
