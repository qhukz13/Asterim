export type ClientType = 'desktop' | 'browser' | 'mobile' | 'cli';

export interface UserIdentity {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isEmailVerified: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccessTokenPayload {
  sub: string;           // User ID
  acc: string;           // Account ID
  sid: string;           // Session ID
  dev?: string;          // Device ID
  typ: ClientType;       // Client Type
  iat: number;           // Issued At (sec)
  exp: number;           // Expiration (sec)
  ent: string[];         // Active entitlement keys
}

export interface RefreshTokenPayload {
  sid: string;           // Session ID
  sub: string;           // User ID
  dev: string;           // Device ID
  jti: string;           // Token Unique ID (nonce)
  iat: number;
  exp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  id: string;
  userId: string;
  deviceId: string;
  ipAddress: string | null;
  userAgent: string | null;
  clientType: ClientType;
  isRevoked: boolean;
  lastActiveAt: number;
  createdAt: number;
  expiresAt: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName?: string;
  clientType?: ClientType;
}

export interface LoginRequest {
  email: string;
  password: string;
  clientType?: ClientType;
  deviceId?: string;
  deviceName?: string;
}

export interface AuthResponse {
  user: UserIdentity;
  tokens: AuthTokens;
  sessionId: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface OAuthCodeExchangeRequest {
  code: string;
  codeVerifier: string;
  clientType: ClientType;
  deviceId?: string;
  deviceName?: string;
  osType?: string;
  osVersion?: string;
  clientVersion?: string;
}

export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  USER_EXISTS = 'USER_EXISTS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  SESSION_REVOKED = 'SESSION_REVOKED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  DEVICE_REVOKED = 'DEVICE_REVOKED',
  RATE_LIMITED = 'RATE_LIMITED',
}
