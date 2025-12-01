import { getPRSData } from './prsService.js';

export default async ({ req, res, log, error }) => {
  const startTime = Date.now();
  
  try {
    let params = {};
    
    if (req.method === 'POST') {
      if (req.body) {
        if (typeof req.body === 'string') {
          try {
            params = JSON.parse(req.body);
          } catch (e) {
            log(`⚠️ Failed to parse body as JSON: ${e.message}`);
            params = req.body;
          }
        } else if (typeof req.body === 'object') {
          params = req.body;
        }
      }
      
      if (req.bodyJson) {
        params = { ...params, ...req.bodyJson };
      }
      
      if (Object.keys(params).length === 0 && req.query) {
        params = req.query;
      }
    } else if (req.method === 'GET') {
      params = req.query || {};
    }
    
    const { name, type, constituency, state } = params;
    
    log(`📥 Received params: ${JSON.stringify(params)}`);
    log(`🔍 [PRS] Request received: ${name} (${type})`);
    
    if (!name || !type) {
      return res.json({
        success: false,
        error: 'Missing required parameters: name, type',
        received: params,
        usage: {
          method: 'POST',
          contentType: 'application/json',
          example: {
            name: 'Rahul Gandhi',
            type: 'MP'
          },
          alternateExample: {
            name: 'Arvind Kejriwal',
            type: 'MLA',
            state: 'Delhi',
            constituency: 'New Delhi'
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
    
    log(`🚀 Starting data fetch for ${name}...`);
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
