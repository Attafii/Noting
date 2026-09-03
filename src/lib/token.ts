const TOKEN_KEY = 'bridge-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function bridgeHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    'x-bridge-token': token ?? '',
    ...extra,
  };
}
