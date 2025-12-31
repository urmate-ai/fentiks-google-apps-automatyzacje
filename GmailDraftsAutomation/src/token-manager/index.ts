import { logger } from '../shared/logger/index.js';
import { createGoogleAuth } from '../auth/google.js';
import { getRefreshToken, saveRefreshToken, getOAuthToken } from './database.js';

export interface TokenStatus {
  isValid: boolean;     
  hasRefreshToken: boolean;
  lastAccessTokenRefresh: string | null; 
  scopes: string[];
  error?: string;
  lastChecked: string;
}

export async function checkTokenStatus(forceRefresh: boolean = false): Promise<TokenStatus> {
  let refreshToken = await getRefreshToken('google');
  if (!refreshToken) {
    refreshToken = process.env.GOOGLE_REFRESH_TOKEN || null;
  }
  
  const status: TokenStatus = {
    isValid: false,
    hasRefreshToken: !!refreshToken,
    lastAccessTokenRefresh: null,
    scopes: [],
    lastChecked: new Date().toISOString(),
  };

  if (!refreshToken) {
    status.error = 'Brak skonfigurowanego refresh tokena';
    return status;
  }

  try {
    const tokenRecord = await getOAuthToken('google');
    
    const now = Date.now();
    const hasValidAccessToken = tokenRecord?.access_token && 
                                 tokenRecord?.expires_at && 
                                 new Date(tokenRecord.expires_at).getTime() > now;
    
    const needsRefresh = forceRefresh || !hasValidAccessToken;

    if (!needsRefresh && tokenRecord) {
      status.isValid = true;
      status.lastAccessTokenRefresh = tokenRecord.updated_at ? new Date(tokenRecord.updated_at).toISOString() : null;
      status.scopes = tokenRecord.scopes || [];
      status.error = undefined;
      return status;
    }

    const auth = createGoogleAuth();
    auth.setCredentials({
      refresh_token: refreshToken,
    });

    try {
      const { credentials } = await auth.refreshAccessToken();
      auth.setCredentials(credentials);

      const scopes = credentials.scope ? credentials.scope.split(' ') : [];
      const expiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : undefined;
      
      await saveRefreshToken(
        credentials.refresh_token || refreshToken,
        credentials.access_token || undefined,
        expiresAt,
        scopes,
        'google'
      );

      status.isValid = true;
      status.lastAccessTokenRefresh = new Date().toISOString();
      status.scopes = scopes;
      status.error = undefined;
      
      if (forceRefresh) {
        logger.info('[Token Manager] Token refreshed and saved to database (forced)');
      } else {
        logger.info('[Token Manager] Token refreshed and saved to database (expired)');
      }
    } catch (refreshError) {
      status.isValid = false;
      status.error = refreshError instanceof Error ? refreshError.message : 'Nie udało się odświeżyć tokena';
      logger.warn('[Token Manager] Refresh token is invalid or expired', refreshError);
      
      status.scopes = [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/drive',
      ];
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : 'Nieznany błąd';
    logger.error('[Token Manager] Error checking token status', error);
  }

  return status;
}

export async function checkRefreshToken(): Promise<{ success: boolean; status?: TokenStatus; error?: string }> {  
  const status = await checkTokenStatus(true);
  
  return {
    success: status.isValid,
    status,
    error: status.error,
  };
}

