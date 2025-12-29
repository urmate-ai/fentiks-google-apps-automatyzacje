import { google } from 'googleapis';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

export function createGoogleAuth() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use Google OAuth'
    );
  }

  const redirectUri = config.googleRedirectUri || 'urn:ietf:wg:oauth:2.0:oob';

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

  if (refreshToken) {
    auth.setCredentials({
      refresh_token: refreshToken,
    });

    try {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);
      logger.info('Google OAuth token refreshed');
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

