// src/main.js - Appwrite Function Entry
import { getPRSData } from './prsService.js';

export default async ({ req, res, log, error }) => {
  const startTime = Date.now();
  
  try {
    const { name, type, constituency, state } = req.body?.length 
      ? JSON.parse(req.body) 
      : req.query;

    log(`🔍 [PRS] Request: ${name} (${type})`);

    if (!name || !type) {
      return res.json({
        success: false,
        error: 'Missing required parameters: name, type',
      }, 400);
    }

    if (!['MP', 'MLA'].includes(type)) {
      return res.json({
        success: false,
        error: 'Invalid type. Must be MP or MLA',
      }, 400);
    }

    const result = await getPRSData(name, type, constituency, state);
    
    const duration = Date.now() - startTime;
    log(`✅ [PRS] Completed in ${duration}ms`);

    if (result.found) {
      return res.json({
        success: true,
        data: result.data, // Flat format with HTML tables
        timing: {
          duration,
          timestamp: new Date().toISOString()
        }
      }, 200);
    } else {
      return res.json({
        success: false,
        message: 'Member not found in PRS India',
        searched: { name, type, constituency, state },
        timing: { duration }
      }, 404);
    }

  } catch (err) {
    const duration = Date.now() - startTime;
    error(`❌ [PRS] Error: ${err.message}`);

    return res.json({
      success: false,
      error: err.message,
      timing: { duration }
    }, 500);
  }
};