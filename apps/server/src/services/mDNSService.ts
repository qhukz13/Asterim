import Bonjour, { Service } from 'bonjour-service';
import { Workstation } from '@agentdeck/shared';
import os from 'os';

export class MDNSService {
  private bonjour: Bonjour | null = null;
  private service: any = null;
  private discoveredWorkstations: Record<string, Workstation> = {};
  private listeners: ((workstations: Workstation[]) => void)[] = [];

  public start(port: number) {
    try {
      this.bonjour = new Bonjour();
      this.service = this.bonjour.publish({
        name: `AgentDeck-${os.hostname()}`,
        type: 'http',
        port: port,
        txt: { service: 'agentdeck' }
      });

      console.log(`[mDNS] Publishing AgentDeck service on port ${port}`);
      this.startDiscovery();
    } catch (err) {
      console.error('[mDNS] Failed to start mDNS service:', err);
    }
  }

  private startDiscovery() {
    if (!this.bonjour) return;
    
    const browser = this.bonjour.find({ type: 'http' });
    
    browser.on('up', (service: Service) => {
      if (service.txt && service.txt.service === 'agentdeck') {
        const ip = service.addresses?.[0] || service.host;
        const id = `${ip}:${service.port}`;
        this.discoveredWorkstations[id] = {
          id,
          name: service.name,
          ip: ip,
          port: service.port,
          lastSeen: Date.now(),
          isOnline: true
        };
        this.notifyListeners();
      }
    });

    browser.on('down', (service: Service) => {
      if (service.txt && service.txt.service === 'agentdeck') {
        const ip = service.addresses?.[0] || service.host;
        const id = `${ip}:${service.port}`;
        if (this.discoveredWorkstations[id]) {
          this.discoveredWorkstations[id].isOnline = false;
          this.notifyListeners();
        }
      }
    });
  }

  public getWorkstations(): Workstation[] {
    return Object.values(this.discoveredWorkstations);
  }

  public onUpdate(listener: (workstations: Workstation[]) => void) {
    this.listeners.push(listener);
  }

  private notifyListeners() {
    const workstations = this.getWorkstations();
    this.listeners.forEach(fn => fn(workstations));
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
