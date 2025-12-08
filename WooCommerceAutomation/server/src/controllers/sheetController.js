import { processRows } from '../services/processService.js';
import axios from 'axios';

let processingQueue = [];
let isProcessing = false;

async function keepServerAlive(serverUrl) {
  const intervalMs = 10 * 60 * 1000; 
  
  const pingInterval = setInterval(async () => {
    try {
      const healthUrl = serverUrl.replace(/\/$/, '') + '/health';
      await axios.get(healthUrl, { timeout: 5000 });
      console.log('[KEEPALIVE] Pinged server to prevent sleep');
    } catch (err) {
      console.warn('[KEEPALIVE] Ping failed (non-critical):', err.message);
    }
  }, intervalMs);

  try {
    const healthUrl = serverUrl.replace(/\/$/, '') + '/health';
    await axios.get(healthUrl, { timeout: 5000 });
  } catch (err) { 
    console.warn('[KEEPALIVE] Initial ping failed (non-critical):', err.message);
  }
  
  return pingInterval;
}

async function processQueue() {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  
  while (processingQueue.length > 0) {
    const { rows, sheetName, resolve, reject } = processingQueue.shift();
    
    try {
      console.log('[QUEUE] Processing batch', { rowsCount: rows.length, queueLength: processingQueue.length, sheetName });
      const summary = await processRows(rows, sheetName);
      console.log('[QUEUE] Batch completed', summary);
      resolve(summary);
    } catch (error) {
      console.error('[QUEUE] Batch failed', error.message);
      reject(error);
    }
  }
  
  isProcessing = false;
}

export async function processSheet(req, res) {
  try {
    const body = req.body || {};
    let rows = Array.isArray(body.rows) ? body.rows
      : Array.isArray(body.values) ? body.values
      : Array.isArray(body.data) ? body.data
      : Array.isArray(body.records) ? body.records
      : (Array.isArray(body) ? body : []);
    
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows array is required' });
    }
    
    const sheetName = body.sheetName || null;
    
    res.status(202).json({ ok: true, message: 'Processing started in background' });
    
    (async () => {
      let keepAliveInterval = null;
      
      try {
        const serverUrl = process.env.PROXY_BASE_URL || req.protocol + '://' + req.get('host');
        keepAliveInterval = await keepServerAlive(serverUrl);
        
        await new Promise((resolve, reject) => {
          processingQueue.push({ rows, sheetName, resolve, reject });
          processQueue();
        });
        
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          console.log('[KEEPALIVE] Stopped - processing completed');
        }
      } catch (procErr) {
        console.error('[PROC] Fatal error', procErr.message, procErr.stack);
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
          console.log('[KEEPALIVE] Stopped - processing failed');
        }
      }
    })();
    
  } catch (e) {
    return res.status(500).json({ 
      accepted: false, 
      error: 'enqueue failed', 
      details: e.message 
    });
  }
}

