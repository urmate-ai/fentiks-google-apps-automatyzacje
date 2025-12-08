import axios from 'axios';
import { getWooConfig } from '../config/index.js';

export async function findUserByEmail(email) {
  const { urlBase, authHeader } = getWooConfig();
  if (!urlBase) return null;
  
  try {
    const checkUrl = `${urlBase}?email=${encodeURIComponent(email)}`;
    const response = await axios.get(checkUrl, { 
      headers: { Authorization: authHeader }, 
      validateStatus: () => true 
    });
    const existingList = Array.isArray(response.data) ? response.data : [];
    return existingList.length > 0 ? existingList[0]?.id : null;
  } catch (error) {
    console.error('[WooCommerce] findUserByEmail error', email, error.message);
    return null;
  }
}

export async function createUser(userData, retryCount = 0) {
  const { urlBase, authHeader } = getWooConfig();
  if (!urlBase) return null;
  
  try {
    let username = `${userData.firstName} ${userData.lastName}`.trim();
    if (retryCount > 0 || username.length === 0) {
      username = userData.email.split('@')[0] || `user_${Date.now()}`;
    }
    
    const customer = {
      email: userData.email,
      first_name: userData.firstName,
      last_name: userData.lastName,
      username: username,
      billing: { 
        first_name: userData.firstName, 
        last_name: userData.lastName, 
        city: userData.city, 
        postcode: userData.postcode, 
        state: 'PL', 
        email: userData.email, 
        company: '', 
        address_1: '', 
        address_2: '', 
        country: '', 
        phone: '' 
      },
      shipping: { 
        first_name: '', 
        last_name: '', 
        company: '', 
        address_1: '', 
        address_2: '', 
        city: '', 
        postcode: '', 
        country: '', 
        state: '', 
        phone: '' 
      }
    };
    
    console.log('[WooCommerce] Creating user - request body', JSON.stringify(customer, null, 2));
    
    const response = await axios.post(urlBase, customer, { 
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, 
      validateStatus: () => true 
    });
    
    if (response.status >= 200 && response.status < 300) {
      const body = response.data || {};
      let userId = body?.id || body?.created?.id || body?.customer?.id || null;
      
      if (!userId) {
        userId = await findUserByEmail(userData.email);
        if (userId) {
          console.log('[WooCommerce] refetched userId', { email: userData.email, userId });
        }
      }
      
      return userId;
    } else {
      const errorData = response.data || {};
      const errorCode = errorData?.code || '';
      
      if (errorCode === 'registration-error-email-exists') {
        console.log('[WooCommerce] email already exists, trying to find by email', userData.email);
        const existingUserId = await findUserByEmail(userData.email);
        if (existingUserId) {
          console.log('[WooCommerce] found existing user', { email: userData.email, userId: existingUserId });
          return existingUserId;
        }
      } else if (errorCode === 'registration-error-username-exists') {
        console.log('[WooCommerce] username already exists, retrying with email as username', userData.email);
        if (retryCount === 0) {
          return await createUser(userData, 1);
        }
        const existingUserId = await findUserByEmail(userData.email);
        if (existingUserId) {
          console.log('[WooCommerce] found existing user by email', { email: userData.email, userId: existingUserId });
          return existingUserId;
        }
        console.error('[WooCommerce] username conflict and user not found by email', userData.email);
      }
      
      console.error('[WooCommerce] create failed', userData.email, response.status, JSON.stringify(response.data).slice(0, 300));
      return null;
    }
  } catch (error) {
    console.error('[WooCommerce] create exception', userData.email, error.message);
    return null;
  }
}

export async function getOrCreateUser(userData) {
  let userId = await findUserByEmail(userData.email);
  let isNew = false;
  
  if (!userId) {
    userId = await createUser(userData);
    if (userId) {
      isNew = true;
      console.log('[WooCommerce] created user', userData.email, userId);
    }
  }
  
  return { userId, isNew };
}

