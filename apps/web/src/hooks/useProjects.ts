import { useState, useEffect } from 'react';

export interface Project {
  id: string;
  name: string;
  path: string;
  relayUrl?: string;
}

export function useProjects(activeBackendUrl?: string, environmentId?: string) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const baseUrl =
    activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;

  const fetchProjects = async () => {
    try {
      setError(null);
      const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const envQuery = environmentId ? `?workspaceId=${environmentId}` : '';
      const res = await fetch(`${baseUrl}/api/v1/projects${envQuery}`, { headers });
      if (res.status === 401 && token) {
        localStorage.removeItem(tokenKey);
      }
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
      setError('Failed to connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [activeBackendUrl, environmentId]);

  return { projects, loading, error, refreshProjects: fetchProjects };
}
