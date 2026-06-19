import { useState, useEffect } from 'react';

export function useAuth() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('agentdeck_token'));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!token);

  useEffect(() => {
    if (token) {
      localStorage.setItem('agentdeck_token', token);
      setIsAuthenticated(true);
    } else {
      localStorage.removeItem('agentdeck_token');
      setIsAuthenticated(false);
    }
  }, [token]);

  const login = async (pin: string, hostUrl?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const url = hostUrl || `${protocol}//${hostname}:3000`;
      
      const res = await fetch(`${url}/api/v1/auth/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (res.ok) {
        const data = await res.json();
        setToken(data.token);
        return { success: true };
      }
      
      let errorMsg = 'Invalid PIN. Check the server console.';
      try {
        const data = await res.json();
        if (data && data.error) {
          errorMsg = data.error;
        }
      } catch (jsonErr) {
        // Ignore JSON parsing errors
      }
      
      return { success: false, error: errorMsg };
    } catch (err: any) {
      console.error('Login failed', err);
      const isNetworkError = err instanceof TypeError;
      const errorMsg = isNetworkError 
        ? 'Network/CORS error. Check server status and console logs.'
        : (err.message || 'Login failed. Check server console.');
      return { success: false, error: errorMsg };
    }
  };

  const logout = () => {
    setToken(null);
  };

  return { token, isAuthenticated, login, logout, setToken };
}
