// src/main.js - Appwrite Function Entry Point
import { getPRSData } from './prsService.js';

/**
 * Main Appwrite Function Handler
 * Required: name, type
 * Optional: constituency, state
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

    // ========================================
    // VALIDATION - Only name and type required
    // ========================================
    errorLocation = 'validation';

    if (!name || !type) {
      return res.json({
        success: false,
        error: {
          message: 'Missing required parameters',
          details: 'Both "name" and "type" are required',
          location: errorLocation,
          code: 'MISSING_REQUIRED_PARAMS'
        },
        received: params,
        required: {
          name: name || '❌ MISSING (required)',
          type: type || '❌ MISSING (required)'
        },
        optional: {
          constituency: constituency || 'not provided',
          state: state || 'not provided'
        },
        usage: {
          minimumExample: {
            name: 'Rahul Gandhi',
            type: 'MP'
          },
          fullExample: {
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
          message: 'Invalid type parameter',
          details: 'Type must be either "MP" or "MLA"',
          location: errorLocation,
          code: 'INVALID_TYPE'
        },
        received: {
          name,
          type,
          constituency: constituency || 'not provided',
          state: state || 'not provided'
        },
        validation: {
          providedType: type,
          allowedTypes: ['MP', 'MLA'],
          caseSensitive: false
        },
        timestamp: new Date().toISOString()
      }, 400);
    }

    // ========================================
    // FETCH DATA
    // ========================================
    errorLocation = 'fetching_data';
    
    const processedParams = {
      name: name.trim(),
      type: type.toUpperCase(),
      constituency: constituency?.trim() || null,
      state: state?.trim() || null
    };

    log(`📊 Starting data fetch for: ${processedParams.name} (${processedParams.type})`);
    
    if (processedParams.constituency) {
      log(`   Constituency filter: ${processedParams.constituency}`);
    }
    if (processedParams.state) {
      log(`   State filter: ${processedParams.state}`);
    }

    const result = await getPRSData(
      processedParams.name,
      processedParams.type,
      processedParams.constituency,
      processedParams.state
    );

    const duration = Date.now() - startTime;

    // ========================================
    // SUCCESS RESPONSE
    // ========================================
    if (result.found) {
      log(`✅ [PRS] Successfully found data in ${duration}ms`);
      
      return res.json({
        success: true,
        data: result.data,
        meta: {
          searchedAs: result.searchedAs || processedParams.type,
          foundAs: result.foundAs || processedParams.type,
          source: 'PRS India',
          scrapedAt: new Date().toISOString(),
          note: result.foundAs !== result.searchedAs 
            ? `Searched as ${result.searchedAs}, but found as ${result.foundAs}`
            : undefined
        },
        request: {
          received: params,
          processed: processedParams
        },
        performance: {
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        }
      }, 200);
    }

    // ========================================
    // NOT FOUND RESPONSE
    // ========================================
    log(`⚠️ [PRS] Member not found in ${duration}ms`);
    
    return res.json({
      success: false,
      error: {
        message: 'Member not found',
        details: 'No matching member found in PRS India database',
        location: 'data_not_found',
        code: 'NOT_FOUND'
      },
      received: params,
      searched: {
        name: processedParams.name,
        type: processedParams.type,
        constituency: processedParams.constituency || 'N/A (not specified)',
        state: processedParams.state || 'N/A (not specified)',
        urlsChecked: result.urlsChecked || [],
        totalUrlsChecked: result.urlsChecked?.length || 0
      },
      suggestions: [
        'Verify the spelling of the name',
        'Try different name formats:',
        '  • Full name: "Narendra Damodardas Modi"',
        '  • Common name: "Narendra Modi"',
        '  • Last name first: "Modi Narendra"',
        'Check if the member is currently in the 18th Lok Sabha (for MPs)',
        `Try the alternate type: ${processedParams.type === 'MP' ? 'MLA' : 'MP'}`,
        'Some members may not have data available on PRS India yet',
        'For MLAs, ensure they are from a state legislature tracked by PRS'
      ],
      performance: {
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      }
    }, 404);

  } catch (err) {
    // ========================================
    // ERROR RESPONSE
    // ========================================
    const duration = Date.now() - startTime;

    error(`❌ [PRS] Error at ${errorLocation}: ${err.message}`);
    error(`Stack trace: ${err.stack}`);
    error(`Parameters received: ${JSON.stringify(params)}`);

    // Determine error type
    let errorType = 'UNKNOWN_ERROR';
    let userMessage = 'An unexpected error occurred';

    if (err.message.includes('JSON')) {
      errorType = 'PARSE_ERROR';
      userMessage = 'Invalid JSON format in request body';
    } else if (err.message.includes('fetch') || err.message.includes('network')) {
      errorType = 'NETWORK_ERROR';
      userMessage = 'Failed to fetch data from PRS India website';
    } else if (err.message.includes('timeout') || err.message.includes('ETIMEDOUT')) {
      errorType = 'TIMEOUT_ERROR';
      userMessage = 'Request timed out while fetching data';
    } else if (err.message.includes('ENOTFOUND') || err.message.includes('DNS')) {
      errorType = 'DNS_ERROR';
      userMessage = 'Unable to reach PRS India website';
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

// Export as default for Appwrite
export default main;
