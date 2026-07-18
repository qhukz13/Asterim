import Bonjour, { Service } from 'bonjour-service';
import { Workstation } from '@asterim/shared';
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
        name: `Asterim-${os.hostname()}`,
        type: 'asterim',
        port: port
      });

      console.log(`[mDNS] Publishing Asterim service on port ${port}`);
      this.startDiscovery();
    } catch (err) {
      console.error('[mDNS] Failed to start mDNS service:', err);
    }
  }

  private startDiscovery() {
    if (!this.bonjour) return;
    
    const browser = this.bonjour.find({ type: 'asterim' });
    
    browser.on('up', (service: Service) => {
      const ip = service.addresses?.find(a => a.includes('.')) || service.addresses?.[0] || service.host;
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
    });

    browser.on('down', (service: Service) => {
      const ip = service.addresses?.find(a => a.includes('.')) || service.addresses?.[0] || service.host;
      const id = `${ip}:${service.port}`;
      if (this.discoveredWorkstations[id]) {
        this.discoveredWorkstations[id].isOnline = false;
        this.notifyListeners();
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
