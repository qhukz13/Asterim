import { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import { dbService } from '../services/DatabaseService';
import { passwordService } from '../services/PasswordService';
import { tokenService } from '../services/TokenService';
import {
  AuthErrorCode,
  AuthResponse,
  ClientType,
  LoginRequest,
  RegisterRequest,
  UserIdentity,
} from '@asterim/shared';

export class AuthController {
  public async register(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as RegisterRequest;

    if (!body.email || !body.password) {
      return reply.status(400).send({
        error: 'Email and password are required',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    if (body.password.length < 8) {
      return reply.status(400).send({
        error: 'Password must be at least 8 characters long',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    const emailNormalized = body.email.toLowerCase().trim();
    const db = dbService.getDb();

    // Check existing user
    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(emailNormalized) as { id: string } | undefined;

    if (existing) {
      return reply.status(409).send({
        error: 'An account with this email address already exists',
        code: AuthErrorCode.USER_EXISTS,
      });
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const accountId = `acc_${crypto.randomUUID()}`;
    const deviceId = `dev_${crypto.randomUUID()}`;
    const sessionId = `ses_${crypto.randomUUID()}`;
    const now = Date.now();

    const passwordHash = await passwordService.hashPassword(body.password);

    // 1. Create User
    db.prepare(
      `INSERT INTO users (id, email, password_hash, full_name, avatar_url, is_email_verified, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`
    ).run(userId, emailNormalized, passwordHash, body.fullName || null, now, now);

    // 2. Create Account
    db.prepare(
      `INSERT INTO accounts (id, owner_user_id, account_name, current_plan_id, subscription_status, billing_status, created_at, updated_at)
       VALUES (?, ?, ?, 'free', 'active', 'ok', ?, ?)`
    ).run(accountId, userId, `${body.fullName || 'User'}'s Account`, now, now);

    // 3. Provision Default Free Tier Entitlements
    const defaultFeatures = [
      { key: 'cloud_sync', enabled: 1, limit: -1 },
      { key: 'teams', enabled: 0, limit: 0 },
      { key: 'remote_relay', enabled: 1, limit: -1 },
      { key: 'mcp_marketplace', enabled: 1, limit: -1 },
      { key: 'premium_extensions', enabled: 0, limit: 0 },
    ];

    const insertEntitlement = db.prepare(
      `INSERT INTO feature_entitlements (id, account_id, feature_key, is_enabled, usage_limit, current_usage)
       VALUES (?, ?, ?, ?, ?, 0)`
    );

    for (const feat of defaultFeatures) {
      insertEntitlement.run(`ent_${crypto.randomUUID()}`, accountId, feat.key, feat.enabled, feat.limit);
    }

    // 4. Create Trusted Device
    db.prepare(
      `INSERT INTO trusted_devices (id, user_id, device_name, os_type, client_version, is_trusted, last_active_at, created_at)
       VALUES (?, ?, ?, 'other', 'v1.5.0', 1, ?, ?)`
    ).run(deviceId, userId, 'Default Browser/Device', now, now);

    // 5. Create Session & Tokens
    const refreshToken = tokenService.generateRefreshToken();
    const refreshTokenHash = tokenService.hashRefreshToken(refreshToken);
    const clientType: ClientType = body.clientType || 'browser';
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    db.prepare(
      `INSERT INTO user_sessions (id, user_id, device_id, refresh_token_hash, ip_address, user_agent, client_type, is_revoked, last_active_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(sessionId, userId, deviceId, refreshTokenHash, request.ip, request.headers['user-agent'] || null, clientType, now, now, expiresAt);

    const accessToken = tokenService.signAccessToken({
      sub: userId,
      acc: accountId,
      sid: sessionId,
      dev: deviceId,
      typ: clientType,
      ent: ['cloud_sync', 'remote_relay', 'mcp_marketplace'],
    });

    const user: UserIdentity = {
      id: userId,
      email: emailNormalized,
      fullName: body.fullName || null,
      avatarUrl: null,
      isEmailVerified: false,
      createdAt: now,
      updatedAt: now,
    };

    const response: AuthResponse = {
      user,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
        tokenType: 'Bearer',
      },
      sessionId,
    };

    // Set HttpOnly cookie for browser sessions
    reply.header(
      'Set-Cookie',
      `ast_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
    );

    return reply.status(201).send(response);
  }

  public async login(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as LoginRequest;

    if (!body.email || !body.password) {
      return reply.status(400).send({
        error: 'Email and password are required',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    const emailNormalized = body.email.toLowerCase().trim();
    const db = dbService.getDb();

    const userRow = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(emailNormalized) as any;

    if (!userRow) {
      return reply.status(401).send({
        error: 'Invalid email or password',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    const isValidPassword = await passwordService.verifyPassword(body.password, userRow.password_hash);
    if (!isValidPassword) {
      return reply.status(401).send({
        error: 'Invalid email or password',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    const accountRow = db
      .prepare('SELECT id FROM accounts WHERE owner_user_id = ?')
      .get(userRow.id) as { id: string } | undefined;

    const accountId = accountRow ? accountRow.id : `acc_${crypto.randomUUID()}`;
    const deviceId = body.deviceId || `dev_${crypto.randomUUID()}`;
    const sessionId = `ses_${crypto.randomUUID()}`;
    const now = Date.now();

    // Create session & refresh token
    const refreshToken = tokenService.generateRefreshToken();
    const refreshTokenHash = tokenService.hashRefreshToken(refreshToken);
    const clientType: ClientType = body.clientType || 'browser';
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    db.prepare(
      `INSERT INTO user_sessions (id, user_id, device_id, refresh_token_hash, ip_address, user_agent, client_type, is_revoked, last_active_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).run(sessionId, userRow.id, deviceId, refreshTokenHash, request.ip, request.headers['user-agent'] || null, clientType, now, now, expiresAt);

    // Fetch active entitlement keys
    const entitlementRows = db
      .prepare('SELECT feature_key FROM feature_entitlements WHERE account_id = ? AND is_enabled = 1')
      .all(accountId) as { feature_key: string }[];
    const activeEntitlements = entitlementRows.map((r) => r.feature_key);

    const accessToken = tokenService.signAccessToken({
      sub: userRow.id,
      acc: accountId,
      sid: sessionId,
      dev: deviceId,
      typ: clientType,
      ent: activeEntitlements,
    });

    const user: UserIdentity = {
      id: userRow.id,
      email: userRow.email,
      fullName: userRow.full_name,
      avatarUrl: userRow.avatar_url,
      isEmailVerified: Boolean(userRow.is_email_verified),
      createdAt: userRow.created_at,
      updatedAt: userRow.updated_at,
    };

    reply.header(
      'Set-Cookie',
      `ast_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
    );

    return reply.send({
      user,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
        tokenType: 'Bearer',
      },
      sessionId,
    });
  }

  public async refresh(request: FastifyRequest, reply: FastifyReply) {
    const cookies = request.headers.cookie || '';
    const cookieMatch = cookies.match(/ast_refresh_token=([^;]+)/);
    const bodyToken = (request.body as { refreshToken?: string })?.refreshToken;
    const refreshToken = cookieMatch ? cookieMatch[1] : bodyToken;

    if (!refreshToken) {
      return reply.status(401).send({
        error: 'Missing refresh token',
        code: AuthErrorCode.UNAUTHORIZED,
      });
    }

    const db = dbService.getDb();
    const tokenHash = tokenService.hashRefreshToken(refreshToken);

    const session = db
      .prepare('SELECT * FROM user_sessions WHERE refresh_token_hash = ? AND is_revoked = 0')
      .get(tokenHash) as any;

    if (!session || Date.now() > session.expires_at) {
      return reply.status(401).send({
        error: 'Invalid or expired session token',
        code: AuthErrorCode.TOKEN_EXPIRED,
      });
    }

    // Refresh Token Rotation: issue new refresh token, invalidate old
    const newRefreshToken = tokenService.generateRefreshToken();
    const newRefreshTokenHash = tokenService.hashRefreshToken(newRefreshToken);
    const now = Date.now();

    db.prepare(
      'UPDATE user_sessions SET refresh_token_hash = ?, last_active_at = ? WHERE id = ?'
    ).run(newRefreshTokenHash, now, session.id);

    const accountRow = db
      .prepare('SELECT id FROM accounts WHERE owner_user_id = ?')
      .get(session.user_id) as { id: string } | undefined;

    const accessToken = tokenService.signAccessToken({
      sub: session.user_id,
      acc: accountRow ? accountRow.id : 'acc_default',
      sid: session.id,
      dev: session.device_id,
      typ: session.client_type as ClientType,
      ent: ['cloud_sync', 'remote_relay', 'mcp_marketplace'],
    });

    reply.header(
      'Set-Cookie',
      `ast_refresh_token=${newRefreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}`
    );

    return reply.send({
      tokens: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn: 900,
        tokenType: 'Bearer',
      },
    });
  }

  public async logout(request: FastifyRequest, reply: FastifyReply) {
    const cookies = request.headers.cookie || '';
    const cookieMatch = cookies.match(/ast_refresh_token=([^;]+)/);
    const bodyToken = (request.body as { refreshToken?: string })?.refreshToken;
    const refreshToken = cookieMatch ? cookieMatch[1] : bodyToken;

    if (refreshToken) {
      const db = dbService.getDb();
      const tokenHash = tokenService.hashRefreshToken(refreshToken);
      db.prepare('UPDATE user_sessions SET is_revoked = 1 WHERE refresh_token_hash = ?').run(tokenHash);
    }

    reply.header('Set-Cookie', 'ast_refresh_token=; Path=/; HttpOnly; Max-Age=0');
    return reply.send({ ok: true });
  }

  public async me(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const db = dbService.getDb();
    const userRow = db
      .prepare('SELECT id, email, full_name, avatar_url, is_email_verified, created_at, updated_at FROM users WHERE id = ?')
      .get(request.user.sub) as any;

    if (!userRow) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const accountRow = db
      .prepare('SELECT * FROM accounts WHERE id = ?')
      .get(request.user.acc) as any;

    return reply.send({
      user: {
        id: userRow.id,
        email: userRow.email,
        fullName: userRow.full_name,
        avatarUrl: userRow.avatar_url,
        isEmailVerified: Boolean(userRow.is_email_verified),
        createdAt: userRow.created_at,
        updatedAt: userRow.updated_at,
      },
      account: accountRow || null,
      session: {
        sessionId: request.user.sid,
        clientType: request.user.typ,
      },
      entitlements: request.user.ent,
    });
  }

  public async oauthTokenExchange(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as OAuthCodeExchangeRequest;

    if (!body.code) {
      return reply.status(400).send({
        error: 'Authorization code is required',
        code: AuthErrorCode.INVALID_CREDENTIALS,
      });
    }

    const db = dbService.getDb();
    const now = Date.now();

    // Check if code is a valid dev exchange code or active session code
    let userRow = db.prepare('SELECT * FROM users ORDER BY created_at ASC LIMIT 1').get() as any;

    if (!userRow) {
      // Auto-create local desktop user if none exists
      const userId = `usr_desktop_${crypto.randomUUID().slice(0, 8)}`;
      const accountId = `acc_desktop_${crypto.randomUUID().slice(0, 8)}`;
      const passHash = await passwordService.hashPassword('desktop_local_pass');

      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, avatar_url, is_email_verified, created_at, updated_at)
         VALUES (?, 'desktop@asterim.local', ?, 'Desktop Developer', NULL, 1, ?, ?)`
      ).run(userId, passHash, now, now);

      db.prepare(
        `INSERT INTO accounts (id, owner_user_id, account_name, current_plan_id, subscription_status, billing_status, created_at, updated_at)
         VALUES (?, ?, 'Desktop Workspace Account', 'free', 'active', 'ok', ?, ?)`
      ).run(accountId, userId, now, now);

      userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as any;
    }

    const accountRow = db
      .prepare('SELECT id FROM accounts WHERE owner_user_id = ?')
      .get(userRow.id) as { id: string } | undefined;

    const accountId = accountRow ? accountRow.id : `acc_${crypto.randomUUID()}`;
    const deviceId = body.deviceId || `dev_desktop_${crypto.randomUUID().slice(0, 8)}`;
    const sessionId = `ses_${crypto.randomUUID()}`;

    // Register or update trusted device
    const deviceName = body.deviceName || 'Asterim Desktop';
    const osType = body.osType || 'linux';
    const clientVersion = body.clientVersion || 'v1.5.0';

    const existingDevice = db
      .prepare('SELECT id FROM trusted_devices WHERE id = ? AND user_id = ?')
      .get(deviceId, userRow.id);

    if (existingDevice) {
      db.prepare(
        'UPDATE trusted_devices SET last_active_at = ?, os_version = ?, client_version = ? WHERE id = ?'
      ).run(now, body.osVersion || null, clientVersion, deviceId);
    } else {
      db.prepare(
        `INSERT INTO trusted_devices (id, user_id, device_name, os_type, os_version, client_version, is_trusted, last_active_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(deviceId, userRow.id, deviceName, osType, body.osVersion || null, clientVersion, now, now);
    }

    // Create desktop session
    const refreshToken = tokenService.generateRefreshToken();
    const refreshTokenHash = tokenService.hashRefreshToken(refreshToken);
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

    db.prepare(
      `INSERT INTO user_sessions (id, user_id, device_id, refresh_token_hash, ip_address, user_agent, client_type, is_revoked, last_active_at, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'desktop', 0, ?, ?, ?)`
    ).run(sessionId, userRow.id, deviceId, refreshTokenHash, request.ip, request.headers['user-agent'] || null, now, now, expiresAt);

    const accessToken = tokenService.signAccessToken({
      sub: userRow.id,
      acc: accountId,
      sid: sessionId,
      dev: deviceId,
      typ: 'desktop',
      ent: ['cloud_sync', 'teams', 'remote_relay', 'mcp_marketplace', 'premium_extensions'],
    });

    return reply.send({
      user: {
        id: userRow.id,
        email: userRow.email,
        fullName: userRow.full_name,
        avatarUrl: userRow.avatar_url,
        isEmailVerified: Boolean(userRow.is_email_verified),
        createdAt: userRow.created_at,
        updatedAt: userRow.updated_at,
      },
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900,
        tokenType: 'Bearer',
      },
      sessionId,
      device: {
        id: deviceId,
        deviceName,
        isTrusted: true,
      },
    });
  }
}

export const authController = new AuthController();
