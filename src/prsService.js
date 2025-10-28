/**
 * Get PRS data for a member
 * @param {string} name - Member name (required)
 * @param {string} type - 'MP' or 'MLA' (required)
 * @param {string|null} constituency - Constituency name (optional)
 * @param {string|null} state - State name (optional)
 * @returns {Promise<Object>}
 */
export async function getPRSData(name, type, constituency = null, state = null) {
  console.log(`🔍 [PRS] Fetching ${name} (${type})`);
  
  if (constituency) {
    console.log(`   📍 Constituency: ${constituency}`);
  }
  if (state) {
    console.log(`   📍 State: ${state}`);
  }

  let urlsChecked = [];

  try {
    const result = await tryFetchWithType(name, type, false);
    urlsChecked = result.urlsChecked || [];

    if (result.found) {
      result.searchedAs = type;
      result.foundAs = type;
      result.urlsChecked = urlsChecked;
      return result;
    }

    const alternateType = type === 'MLA' ? 'MP' : 'MLA';
    console.log(`⚠️ [PRS] Trying alternate: ${alternateType}`);

    const altResult = await tryFetchWithType(name, alternateType, true);
    urlsChecked = [...urlsChecked, ...(altResult.urlsChecked || [])];

    if (altResult.found) {
      altResult.searchedAs = type;
      altResult.foundAs = alternateType;
      altResult.urlsChecked = urlsChecked;
      return altResult;
    }

    return { 
      ...getEmptyResponse(), 
      urlsChecked 
    };
  } catch (error) {
    console.error(`❌ [PRS] Error in getPRSData: ${error.message}`);
    throw new Error(`Failed to fetch PRS data: ${error.message}`);
  }
}
