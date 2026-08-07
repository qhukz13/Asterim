import { useState, useEffect } from 'react';

export function useAuth(activeBackendUrl?: string) {
  const getStorageKey = () =>
    activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
  const [token, setToken] = useState<string | null>(localStorage.getItem(getStorageKey()));

  useEffect(() => {
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    setToken(stored);
  }, [activeBackendUrl]);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!token);

  useEffect(() => {
    const key = getStorageKey();
    if (token) {
      localStorage.setItem(key, token);
      setIsAuthenticated(true);
    } else {
      localStorage.removeItem(key);
      setIsAuthenticated(false);
    }
  }, [token, activeBackendUrl]);

  const loginWithOAuthCode = async (
    code: string,
    hostUrl?: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const protocol = window.location.protocol;
      const hostname = window.location.hostname;
      const url = hostUrl || `${protocol}//${hostname}:3000`;

      const res = await fetch(`${url}/api/v1/auth/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          codeVerifier: 'pkce_local_verifier',
          clientType: 'desktop',
          deviceName: 'Asterim Desktop',
          osType: 'linux',
          clientVersion: 'v1.5.0'
        })
      });

      if (res.ok) {
        const data = await res.json();
        const accessToken = data.tokens?.accessToken || data.token;
        localStorage.setItem(getStorageKey(), accessToken);
        setToken(accessToken);
        setIsAuthenticated(true);
        return { success: true };
      }

      const data = await res.json();
      return { success: false, error: data.error || 'OAuth token exchange failed' };
    } catch (err: any) {
      return { success: false, error: err.message || 'OAuth authentication failed' };
    }
  };

  const login = async (
    pin: string,
    hostUrl?: string
  ): Promise<{ success: boolean; error?: string }> => {
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
        localStorage.setItem(getStorageKey(), data.token);
        setToken(data.token);
        setIsAuthenticated(true);
        return { success: true };
      }

      let errorMsg = 'Invalid PIN. Check the server console.';
      try {
        const data = await res.json();
        if (data && data.error) {
          errorMsg = data.error;
        }
      } catch (jsonErr) {
        // Ignore
      }

      return { success: false, error: errorMsg };
    } catch (err: any) {
      console.error('Login failed', err);
      const isNetworkError = err instanceof TypeError;
      const errorMsg = isNetworkError
        ? 'Network/CORS error. Check server status and console logs.'
        : err.message || 'Login failed. Check server console.';
      return { success: false, error: errorMsg };
    }
  };

  const logout = () => {
    localStorage.removeItem(getStorageKey());
    setToken(null);
    setIsAuthenticated(false);
  };

  return { token, isAuthenticated, login, loginWithOAuthCode, logout, setToken };
}
