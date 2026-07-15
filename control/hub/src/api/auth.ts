/**
 * Authentication middleware for REST API endpoints.
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Middleware that requires a valid access token.
 * Token can be provided as:
 * - Authorization: Bearer <token>
 * - Query parameter: ?token=<token>
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;

  let token: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (queryToken) {
    token = queryToken;
  }

  if (!token || token !== config.hubAccessToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
