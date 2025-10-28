// src/main.js - Appwrite Function Entry Point
import { getPRSData } from './prsService.js';

/**
 * Main Appwrite Function Handler
 */
export async function main({ req, res, log, error }) {
  const startTime = Date.now();
  let params = {};
  let errorLocation = 'initialization';

  try {
    // Parse request parameters
    errorLocation = 'parsing_request';

    if (req.method === 'POST' && req.body) {
      params = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } else if (req.method === 'GET') {
      params = req.query;
    } else {
      params = {};
    }

    const { name, type, constituency, state } = params;

    log(`🔍 [PRS] Request received: ${JSON.stringify(params)}`);

    // Validation
    errorLocation = 'validation';

    if (!name || !type) {
      return res.json({
        success: false,
        error: {
          message: 'Missing required parameters: name and type are mandatory',
          location: errorLocation,
          code: 'MISSING_PARAMS'
        },
        received: params,
        required: {
          name: name || 'MISSING',
          type: type || 'MISSING',
          constituency: constituency || 'OPTIONAL',
          state: state || 'OPTIONAL'
        },
        usage: {
          example: {
            name: 'Rahul Gandhi',
            type: 'MP',
            constituency: 'Wayanad',
            state: 'Kerala'
          }
        },
        timestamp: new Date().toISOString()
      }, 400);
    }

    if (!['MP', 'MLA'].includes(type.toUpperCase())) {
      return res.json({
        success: false,
        error: {
          message: 'Invalid type. Must be MP or MLA',
          location: errorLocation,
          code: 'INVALID_TYPE'
        },
        received: params,
        validation: {
          providedType: type,
          allowedTypes: ['MP', 'MLA']
        },
        timestamp: new Date().toISOString()
      }, 400);
    }

    // Fetch data
    errorLocation = 'fetching_data';
    log(`📊 Starting data fetch for: ${name} (${type})`);

    const result = await getPRSData(
      name.trim(), 
      type.toUpperCase(), 
      constituency?.trim(), 
      state?.trim()
    );

    const duration = Date.now() - startTime;

    if (result.found) {
      log(`✅ [PRS] Successfully found data in ${duration}ms`);
      
      return res.json({
        success: true,
        data: result.data,
        meta: {
          searchedAs: result.searchedAs || type,
          foundAs: result.foundAs || type,
          source: 'PRS India',
          scrapedAt: new Date().toISOString()
        },
        request: {
          received: params,
          processed: {
            name: name.trim(),
            type: type.toUpperCase(),
            constituency: constituency?.trim() || null,
            state: state?.trim() || null
          }
        },
        performance: {
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        }
      }, 200);
      
    } else {
      log(`⚠️ [PRS] Member not found in ${duration}ms`);
      
      return res.json({
        success: false,
        error: {
          message: 'Member not found in PRS India database',
          location: 'data_not_found',
          code: 'NOT_FOUND'
        },
        received: params,
        searched: { 
          name: name.trim(), 
          type: type.toUpperCase(), 
          constituency: constituency?.trim() || 'N/A', 
          state: state?.trim() || 'N/A',
          urlsChecked: result.urlsChecked || []
        },
        suggestions: [
          'Verify the spelling of the name',
          'Try alternate name formats (e.g., "Narendra Modi" vs "Modi, Narendra")',
          'Check if the member is currently serving',
          `Try alternate type (${type === 'MP' ? 'MLA' : 'MP'})`,
          'Some members might not have data available on PRS India'
        ],
        performance: { 
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        }
      }, 404);
    }
  } catch (err) {
    const duration = Date.now() - startTime;

    // Enhanced error logging
    error(`❌ [PRS] Error at ${errorLocation}: ${err.message}`);
    error(`Stack trace: ${err.stack}`);
    error(`Parameters received: ${JSON.stringify(params)}`);

    // Determine error type and message
    let errorType = 'UNKNOWN_ERROR';
    let userMessage = 'An unexpected error occurred while fetching data';

    if (err.message.includes('JSON')) {
      errorType = 'PARSE_ERROR';
      userMessage = 'Invalid JSON format in request body';
    } else if (err.message.includes('fetch')) {
      errorType = 'NETWORK_ERROR';
      userMessage = 'Failed to fetch data from PRS India website';
    } else if (err.message.includes('timeout')) {
      errorType = 'TIMEOUT_ERROR';
      userMessage = 'Request timed out while fetching data';
    }

    return res.json({
      success: false,
      error: {
        message: userMessage,
        technicalMessage: err.message,
        type: errorType,
        location: errorLocation,
        code: err.code || 'INTERNAL_ERROR'
      },
      received: params,
      debug: {
        stack: process.env.APPWRITE_FUNCTION_ENV === 'development' ? err.stack : undefined,
        errorLocation: errorLocation,
        errorName: err.name,
        timestamp: new Date().toISOString()
      },
      performance: { 
        duration: `${duration}ms`,
        failedAt: errorLocation
      }
    }, 500);
  }
}

// Also export as default for compatibility
export default main;
