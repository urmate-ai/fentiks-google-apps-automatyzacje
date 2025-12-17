import { google } from 'googleapis';
import { config } from '../shared/config/index.js';
import { logger } from '../shared/logger/index.js';

export function createGoogleAuth() {
  const oauth2Client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
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
        'https://www.googleapis.com/auth/drive.readonly',
      ],
    });

    logger.info('Please visit this URL to authorize the application:');
    logger.info(authUrl);
    throw new Error('No refresh token provided. Please authorize the application first.');
  }

  return auth;
}

