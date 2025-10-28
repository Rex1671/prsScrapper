// src/main.js - Appwrite Function Entry Point (FIXED)
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
    // ========================================
    // PARSE REQUEST - Multiple fallback methods
    // ========================================
    errorLocation = 'parsing_request';

    log(`📥 Request method: ${req.method}`);
    log(`📦 Request body type: ${typeof req.body}`);
    log(`📦 Request bodyRaw: ${req.bodyRaw ? 'present' : 'not present'}`);
    log(`📦 Request payload: ${req.payload ? 'present' : 'not present'}`);

    // Try different parsing methods for Appwrite compatibility
    if (req.method === 'POST') {
      // Method 1: Check if body is already parsed object
      if (req.body && typeof req.body === 'object') {
        params = req.body;
        log('✅ Parsed from req.body (object)');
      }
      // Method 2: Check bodyRaw (Appwrite often uses this)
      else if (req.bodyRaw) {
        try {
          params = JSON.parse(req.bodyRaw);
          log('✅ Parsed from req.bodyRaw');
        } catch (e) {
          log(`⚠️ Failed to parse bodyRaw: ${e.message}`);
          params = {};
        }
      }
      // Method 3: Check if body is a string
      else if (req.body && typeof req.body === 'string') {
        try {
          params = JSON.parse(req.body);
          log('✅ Parsed from req.body (string)');
        } catch (e) {
          log(`⚠️ Failed to parse body string: ${e.message}`);
          params = {};
        }
      }
      // Method 4: Check payload (some Appwrite versions)
      else if (req.payload) {
        try {
          params = typeof req.payload === 'string' ? JSON.parse(req.payload) : req.payload;
          log('✅ Parsed from req.payload');
        } catch (e) {
          log(`⚠️ Failed to parse payload: ${e.message}`);
          params = {};
        }
      }
      // Method 5: Check headers for JSON
      else if (req.headers['content-type']?.includes('application/json')) {
        log('⚠️ Content-Type is JSON but no body found');
        params = {};
      }
      else {
        log('⚠️ No valid POST body found');
        params = {};
      }
    } 
    // GET request - use query parameters
    else if (req.method === 'GET') {
      params = req.query || req.queries || {};
      log('✅ Parsed from query parameters');
    }
    else {
      log(`⚠️ Unsupported method: ${req.method}`);
      params = {};
    }

    // Log what we received
    log(`📋 Parsed params: ${JSON.stringify(params)}`);

    const { name, type, constituency, state } = params;

    // ========================================
    // VALIDATION - Only name and type required
    // ========================================
    errorLocation = 'validation';

    if (!name || !type) {
      log(`❌ Validation failed - name: ${name}, type: ${type}`);
      
      return res.json({
        success: false,
        error: {
          message: 'Missing required parameters',
          details: 'Both "name" and "type" are required',
          location: errorLocation,
          code: 'MISSING_REQUIRED_PARAMS'
        },
        received: params,
        debug: {
          requestMethod: req.method,
          bodyType: typeof req.body,
          hasBodyRaw: !!req.bodyRaw,
          hasPayload: !!req.payload,
          contentType: req.headers['content-type'] || 'not provided'
        },
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
          },
          postExample: `curl -X POST https://your-endpoint -H "Content-Type: application/json" -d '{"name":"Rahul Gandhi","type":"MP"}'`,
          getExample: `curl "https://your-endpoint?name=Rahul+Gandhi&type=MP"`
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
      log(`   📍 Constituency filter: ${processedParams.constituency}`);
    }
    if (processedParams.state) {
      log(`   📍 State filter: ${processedParams.state}`);
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
          sourceUrl: result.sourceUrl || 'N/A',
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
