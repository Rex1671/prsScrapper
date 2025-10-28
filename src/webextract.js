// src/webextract.js - Robust HTML fetching with retries and proper headers

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const TIMEOUT = 15000; // 15 seconds

/**
 * Fetches HTML content from a URL with retry logic and proper headers
 * @param {string} url - The URL to fetch
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<string|null>} - HTML content or null if failed
 */
export async function fetchHTML(url, retries = MAX_RETRIES) {
  try {
    console.log(`🌐 Fetching: ${url} (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': 'https://prsindia.org/',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.log(`❌ HTTP ${response.status} - ${url}`);
      
      // Retry on server errors (5xx) or rate limiting (429)
      if ((response.status >= 500 || response.status === 429) && retries > 0) {
        console.log(`🔄 Retrying in ${RETRY_DELAY}ms...`);
        await sleep(RETRY_DELAY);
        return fetchHTML(url, retries - 1);
      }
      
      return null;
    }

    const html = await response.text();
    
    // Validate HTML content
    if (!html || html.length < 500) {
      console.log(`⚠️ Response too short (${html?.length || 0} bytes)`);
      
      if (retries > 0) {
        await sleep(RETRY_DELAY);
        return fetchHTML(url, retries - 1);
      }
      
      return null;
    }

    // Check if it's an error page
    if (html.includes('404') && html.includes('not found')) {
      console.log(`📄 404 Not Found - ${url}`);
      return null;
    }

    console.log(`✅ Fetched ${html.length} bytes`);
    return html;

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`⏱️ Timeout after ${TIMEOUT}ms - ${url}`);
    } else {
      console.log(`❌ Fetch error: ${err.message}`);
    }

    // Retry on network errors
    if (retries > 0) {
      console.log(`🔄 Retrying in ${RETRY_DELAY}ms... (${retries} attempts left)`);
      await sleep(RETRY_DELAY);
      return fetchHTML(url, retries - 1);
    }

    return null;
  }
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch multiple URLs in parallel with controlled concurrency
 * @param {string[]} urls - Array of URLs to fetch
 * @param {number} concurrency - Max concurrent requests (default: 3)
 * @returns {Promise<Array<{url: string, html: string|null}>>}
 */
export async function fetchMultipleHTML(urls, concurrency = 3) {
  const results = [];
  const executing = [];

  for (const url of urls) {
    const promise = fetchHTML(url).then(html => ({ url, html }));
    results.push(promise);

    if (concurrency <= urls.length) {
      const e = promise.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

/**
 * Test if a URL is accessible (HEAD request)
 * @param {string} url - URL to test
 * @returns {Promise<boolean>}
 */
export async function isURLAccessible(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
    
  } catch (err) {
    return false;
  }
}
