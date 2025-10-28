// src/main.js - Appwrite Function Entry Point
import { getPRSData } from './prsService.js';

export default async ({ req, res, log, error }) => {
  const startTime = Date.now();
  
  try {
    // Parse request parameters
    let params;
    
    if (req.method === 'POST' && req.body) {
      params = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } else if (req.method === 'GET') {
      params = req.query;
    } else {
      params = {};
    }
    
    const { name, type, constituency, state } = params;
    
    log(`🔍 [PRS] Request received: ${name} (${type})`);
    
    // Validation
    if (!name || !type) {
      return res.json({
        success: false,
        error: 'Missing required parameters: name, type',
        usage: {
          example: {
            name: 'Rahul Gandhi',
            type: 'MP'
          }
        }
      }, 400);
    }
    
    if (!['MP', 'MLA'].includes(type.toUpperCase())) {
      return res.json({
        success: false,
        error: 'Invalid type. Must be MP or MLA',
        received: type
      }, 400);
    }
    
    // Fetch data
    const result = await getPRSData(
      name.trim(), 
      type.toUpperCase(), 
      constituency?.trim(), 
      state?.trim()
    );
    
    const duration = Date.now() - startTime;
    log(`✅ [PRS] Completed in ${duration}ms`);
    
    if (result.found) {
      return res.json({
        success: true,
        data: result.data,
        meta: {
          searchedAs: result.searchedAs || type,
          foundAs: result.foundAs || type,
          source: 'PRS India',
          scrapedAt: new Date().toISOString()
        },
        timing: {
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        }
      }, 200);
    } else {
      return res.json({
        success: false,
        message: 'Member not found in PRS India database',
        searched: { 
          name, 
          type, 
          constituency: constituency || 'N/A', 
          state: state || 'N/A' 
        },
        timing: { 
          duration: `${duration}ms` 
        },
        suggestions: [
          'Verify the spelling of the name',
          'Try alternate name formats (e.g., "Narendra Modi" vs "Modi, Narendra")',
          'Check if the member is currently serving',
          `Try alternate type (${type === 'MP' ? 'MLA' : 'MP'})`
        ]
      }, 404);
    }
    
  } catch (err) {
    const duration = Date.now() - startTime;
    error(`❌ [PRS] Error: ${err.message}`);
    error(err.stack);
    
    return res.json({
      success: false,
      error: err.message,
      type: err.name,
      timing: { 
        duration: `${duration}ms` 
      },
      debug: process.env.NODE_ENV === 'development' ? {
        stack: err.stack
      } : undefined
    }, 500);
  }
};
