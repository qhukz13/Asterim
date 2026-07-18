import { useState, useEffect } from 'react';

export interface Project {
  id: string;
  name: string;
  path: string;
  relayUrl?: string;
}

export function useProjects(activeBackendUrl?: string) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;

  const fetchProjects = async () => {
    try {
      setError(null);
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      
      if (!token) {
        setProjects([]);
        setLoading(false);
        return;
      }
      
      const headers = { 'Authorization': `Bearer ${token}` };
      const res = await fetch(`${baseUrl}/api/v1/projects`, { headers });
      if (res.status === 401) {
        localStorage.removeItem(tokenKey);
        window.location.reload();
        return;
      }
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error('Failed to fetch projects', err);
      setError('Failed to connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [activeBackendUrl]);

  return { projects, loading, error, refreshProjects: fetchProjects };
}
