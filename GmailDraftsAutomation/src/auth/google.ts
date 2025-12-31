import { google } from 'googleapis';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';
import { getRefreshToken, saveRefreshToken } from '../token-manager/database.js';

export function createGoogleAuth(useWebCallback: boolean = false) {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use Google OAuth'
    );
  }

  let redirectUri = config.googleRedirectUri || 'urn:ietf:wg:oauth:2.0:oob';
  if (useWebCallback) {
    const port = process.env.PORT || '8080';
    redirectUri = `http://localhost:${port}/oauth/callback`;
  }

  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    redirectUri
  );

  return oauth2Client;
}

export async function getAuthenticatedClient(
  refreshToken?: string
): Promise<ReturnType<typeof createGoogleAuth>> {
  const auth = createGoogleAuth();

  if (!refreshToken) {
    refreshToken = await getRefreshToken('google') || process.env.GOOGLE_REFRESH_TOKEN || undefined;
  }

  if (refreshToken) {
    auth.setCredentials({
      refresh_token: refreshToken,
    });

    try {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);
      
      const scopes = credentials.scope ? credentials.scope.split(' ') : undefined;
      const expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : undefined;
      
      await saveRefreshToken(
        credentials.refresh_token || refreshToken,
        credentials.access_token || undefined,
        expiresAt,
        scopes,
        'google'
      );
      
      logger.info('Google OAuth token refreshed and saved to database');
    } catch (error) {
      logger.error('Failed to refresh Google OAuth token', error);
      throw error;
    }
  } else {
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/drive',
      ],
    });

    logger.info('Please visit this URL to authorize the application:');
    logger.info(authUrl);
    throw new Error('No refresh token provided. Please authorize the application first.');
  }

  return auth;
}

export function generateAuthUrl(useWebCallback: boolean = true): string {
  const auth = createGoogleAuth(useWebCallback);
  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/drive',
    ],
    prompt: 'consent',
  });
}

export async function exchangeCodeForTokens(code: string, useWebCallback: boolean = true): Promise<{ refresh_token: string; access_token?: string }> {
  const auth = createGoogleAuth(useWebCallback);
  
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);

  if (!tokens.refresh_token) {
    throw new Error('No refresh token received from Google. Make sure access_type is set to "offline".');
  }

  const scopes = tokens.scope ? tokens.scope.split(' ') : undefined;
  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;
  
  await saveRefreshToken(
    tokens.refresh_token,
    tokens.access_token || undefined,
    expiresAt,
    scopes,
    'google'
  );

  logger.info('OAuth tokens saved to database');

  return {
    refresh_token: tokens.refresh_token || '',
    access_token: tokens.access_token || undefined,
  };
}

