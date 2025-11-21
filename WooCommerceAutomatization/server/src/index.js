import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.use((req, _res, next) => {
  try {
    console.log('[REQ] ========================================');
    console.log('[REQ] Method:', req.method);
    console.log('[REQ] Path:', req.path);
    console.log('[REQ] Query:', JSON.stringify(req.query, null, 2));
    console.log('[REQ] Body:');
    
    if (req.body && req.body.rows && Array.isArray(req.body.rows)) {
      console.log('[REQ]   sheetName:', req.body.sheetName);
      console.log('[REQ]   rows count:', req.body.rows.length);
      console.log('[REQ]   rows data:');
      req.body.rows.forEach((row, idx) => {
        console.log(`[REQ]     row[${idx}]:`, JSON.stringify(row, null, 2));
      });
    } else {
      console.log('[REQ]   Full body:', JSON.stringify(req.body, null, 2));
    }
    
    console.log('[REQ] ========================================');
  } catch (e) {
    console.error('[REQ_LOG_ERROR]', e?.message, e?.stack);
  }
  next();
});

import { processSheet } from './controllers/sheetController.js';

app.get('/health', (req, res) => {
  return res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post('/api/sheet/process', processSheet);

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.log('Started Fentiks API v 1.1.6');
  console.log(`Proxy API running on http://localhost:${port}`);
});
