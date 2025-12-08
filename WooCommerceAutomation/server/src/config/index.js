export function getWooConfig() {
  const urlBase = process.env.WOOC_URL_BASE || '';
  const consumerKey = process.env.WOOC_CONSUMER_KEY || '';
  const consumerSecret = process.env.WOOC_CONSUMER_SECRET || '';
  const basicToken = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const authHeader = `Basic ${basicToken}`;
  return { urlBase, authHeader };
}

export function getTutorConfig() {
  const apiUrl = process.env.TUTOR_API_URL || '';
  const apiKey = process.env.TUTOR_API_KEY || '';
  const privateKey = process.env.TUTOR_PRIVATE_API_KEY || '';
  const token = Buffer.from(`${apiKey}:${privateKey}`).toString('base64');
  const basicHeader = `Basic ${token}`;
  const buildHeaders = () => ({
    Authorization: basicHeader,
    'Content-Type': 'application/json',
  });
  return { apiUrl, buildHeaders };
}

export function getHubSpotConfig() {
  const privateToken = process.env.HUBSPOT_PRIVATE_TOKEN || '';
  return { privateToken };
}

export const DEFAULT_COURSE_IDS = [8179, 8575, 8582, 8589, 8597, 8614, 8620, 8725, 9636, 10483, 11783];

export const BATCH_SIZE = 20;

