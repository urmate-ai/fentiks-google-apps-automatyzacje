#!/usr/bin/env node

import { createGoogleAuth } from './google.js';
import { logger } from '../shared/logger/index.js';
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

    console.log('\n========================================');
    console.log('Authorization successful!');
    console.log('========================================\n');
    console.log('Add this to your .env file:');
    console.log(`\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

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

