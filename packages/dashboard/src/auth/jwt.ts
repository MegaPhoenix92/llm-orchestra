/**
 * JWT Token Generation and Verification Utilities
 * Supports access tokens (15 min) and refresh tokens (7 days)
 */

import jwt from 'jsonwebtoken';

/** Access token expiration: 15 minutes */
const ACCESS_TOKEN_EXPIRY = '15m';
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;

/** Refresh token expiration: 7 days */
const REFRESH_TOKEN_EXPIRY = '7d';

export interface JwtPayload {
  /** User ID (subject) */
  sub: string;
  /** User email */
  email: string;
  /** Token type: access or refresh */
  type: 'access' | 'refresh';
}

export interface TokenPair {
  /** Short-lived access token for API requests */
  accessToken: string;
  /** Long-lived refresh token for obtaining new access tokens */
  refreshToken: string;
  /** Access token expiration time in seconds */
  expiresIn: number;
}

interface TokenInput {
  userId: string;
  email: string;
}

/**
 * Generate a pair of access and refresh tokens
 * @param payload - Object containing userId and email
 * @param secret - JWT signing secret
 * @returns TokenPair with accessToken, refreshToken, and expiresIn
 */
export function generateTokenPair(payload: TokenInput, secret: string): TokenPair {
  const accessToken = generateAccessToken(payload, secret);
  const refreshToken = generateRefreshToken(payload, secret);

  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  };
}

/**
 * Verify and decode a JWT token
 * @param token - The JWT token to verify
 * @param secret - JWT signing secret
 * @returns Decoded JwtPayload if valid, null if invalid or expired
 */
export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;

    // Validate required fields
    if (!decoded.sub || !decoded.email || !decoded.type) {
      return null;
    }

    return {
      sub: decoded.sub,
      email: decoded.email,
      type: decoded.type as 'access' | 'refresh',
    };
  } catch {
    return null;
  }
}

/**
 * Generate an access token (expires in 15 minutes)
 * @param payload - Object containing userId and email
 * @param secret - JWT signing secret
 * @returns Signed JWT access token
 */
export function generateAccessToken(payload: TokenInput, secret: string): string {
  return jwt.sign(
    {
      sub: payload.userId,
      email: payload.email,
      type: 'access',
    },
    secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate a refresh token (expires in 7 days)
 * @param payload - Object containing userId and email
 * @param secret - JWT signing secret
 * @returns Signed JWT refresh token
 */
export function generateRefreshToken(payload: TokenInput, secret: string): string {
  return jwt.sign(
    {
      sub: payload.userId,
      email: payload.email,
      type: 'refresh',
    },
    secret,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}
