#!/usr/bin/env node

import { createGoogleAuth } from './google.js';
import { logger } from '../shared/logger/index.js';
import { saveRefreshToken } from '../token-manager/database.js';
import { initializeDatabase } from '../shared/database/index.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function setupOAuth() {
  try {
    await initializeDatabase();
    
    const auth = createGoogleAuth();

    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/drive',
      ],
    });

    console.log('\n========================================');
    console.log('Google OAuth Setup');
    console.log('========================================\n');
    console.log('1. Visit this URL to authorize the application:');
    console.log(`\n${authUrl}\n`);
    console.log('2. After authorization, you will be redirected to a URL.');
    console.log('3. Copy the "code" parameter from the redirect URL.\n');

    const code = await question('Enter the authorization code: ');

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

    console.log('\n========================================');
    console.log('Authorization successful!');
    console.log('========================================\n');
    console.log('✅ Token został zapisany w bazie danych!');
    console.log('\nToken jest teraz przechowywany w bazie danych.');
    console.log('Nie musisz już ustawiać GOOGLE_REFRESH_TOKEN w .env\n');

    if (tokens.access_token) {
      console.log('Access token (temporary):');
      console.log(tokens.access_token.substring(0, 20) + '...\n');
    }

    rl.close();
  } catch (error) {
    logger.error('OAuth setup failed', error);
    rl.close();
    process.exit(1);
  }
}

setupOAuth();

