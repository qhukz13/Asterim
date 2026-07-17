import { useState, useEffect } from 'react';
import { Workstation, WorkstationConfig } from '@agentdeck/shared';

const DEFAULT_CONFIG: WorkstationConfig = {
  developerMode: false,
  knownWorkstations: {}
};

export function useWorkstations() {
  const [config, setConfig] = useState<WorkstationConfig>(() => {
    const stored = localStorage.getItem('agentdeck_workstation_config');
    return stored ? JSON.parse(stored) : DEFAULT_CONFIG;
  });
  
  const [discovered, setDiscovered] = useState<Workstation[]>([]);

  useEffect(() => {
    localStorage.setItem('agentdeck_workstation_config', JSON.stringify(config));
  }, [config]);

  const fetchDiscovered = async () => {
    try {
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      // Query the local server for discovery
      const res = await fetch(`${protocol}//${hostname}:3000/api/v1/system/workstations`);
      if (res.ok) {
        const data = await res.json();
        setDiscovered(data.workstations || []);
        
        // Auto-update known workstations
        if (data.workstations && data.workstations.length > 0) {
          setConfig((prev: WorkstationConfig) => {
            const newKnown = { ...prev.knownWorkstations };
            data.workstations.forEach((w: Workstation) => {
              newKnown[w.id] = w;
            });
            return { ...prev, knownWorkstations: newKnown };
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch discovered workstations', e);
    }
  };

  useEffect(() => {
    if (config.developerMode) {
      fetchDiscovered();
      const interval = setInterval(fetchDiscovered, 5000);
      return () => clearInterval(interval);
    }
  }, [config.developerMode]);

  const activeWorkstation = config.preferredWorkstationId 
    ? config.knownWorkstations[config.preferredWorkstationId] || discovered.find(w => w.id === config.preferredWorkstationId)
    : null;

  const activeBackendUrl = activeWorkstation 
    ? `http://${activeWorkstation.ip}:${activeWorkstation.port}`
    : `http://${window.location.hostname}:3000`; // fallback to current host

  const setActiveWorkstation = (id: string | undefined) => {
    setConfig((prev: WorkstationConfig) => ({ ...prev, preferredWorkstationId: id }));
  };

  const setDeveloperMode = (enabled: boolean) => {
    setConfig((prev: WorkstationConfig) => ({ ...prev, developerMode: enabled }));
  };
  
  const forgetWorkstation = (id: string) => {
    setConfig((prev: WorkstationConfig) => {
      const newKnown = { ...prev.knownWorkstations };
      delete newKnown[id];
      return { 
        ...prev, 
        knownWorkstations: newKnown,
        preferredWorkstationId: prev.preferredWorkstationId === id ? undefined : prev.preferredWorkstationId
      };
    });
  };

  const addManualWorkstation = (ip: string, port: number) => {
    const id = `${ip}:${port}`;
    setConfig((prev: WorkstationConfig) => ({
      ...prev,
      knownWorkstations: {
        ...prev.knownWorkstations,
        [id]: { id, name: `Manual (${ip})`, ip, port, lastSeen: Date.now(), isOnline: true }
      }
    }));
  };

  return {
    config,
    discovered,
    activeWorkstation,
    activeBackendUrl,
    setActiveWorkstation,
    setDeveloperMode,
    forgetWorkstation,
    addManualWorkstation
  };
}
