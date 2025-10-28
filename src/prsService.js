// src/prsService.js - OPTIMIZED VERSION with Priority Queue & Early Termination
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchHTML } from './webextract.js';

const limit = pLimit(8);

export async function getPRSData(name, type, constituency = null, state = null) {
  console.log(`🔍 [PRS] Fetching ${name} (${type})`);
  
  try {
    const result = await tryFetchWithType(name, type, false);
    
    if (result.found) {
      result.searchedAs = type;
      result.foundAs = type;
      return result;
    }

    const alternateType = type === 'MLA' ? 'MP' : 'MLA';
    console.log(`⚠️ [PRS] Trying alternate: ${alternateType}`);
    
    const altResult = await tryFetchWithType(name, alternateType, true);
    
    if (altResult.found) {
      altResult.searchedAs = type;
      altResult.foundAs = alternateType;
      return altResult;
    }

    return getEmptyResponse();

  } catch (error) {
    console.error(`❌ [PRS] Error: ${error.message}`);
    return getEmptyResponse();
  }
}

// ============================================================================
// PRIORITY QUEUE APPROACH - CHECK MOST LIKELY URLS FIRST WITH EARLY TERMINATION
// ============================================================================

async function tryFetchWithType(name, type, reduced = false) {
  const urls = constructURLs(name, type, reduced);
  
  if (urls.length === 0) {
    console.log(`⚠️ [PRS] No URLs generated for ${name}`);
    return getEmptyResponse();
  }
  
  console.log(`🔗 [PRS] Checking up to ${urls.length} URLs with priority-based early termination`);

  // Group URLs by priority for MPs
  let priorityGroups = [];
  
  if (type === 'MP') {
    priorityGroups = [
      // Priority 1: 18th Lok Sabha, base name, no suffix
      urls.filter(u => u.includes('18th-lok-sabha') && !u.match(/-\d+$/)),
      
      // Priority 2: 18th Lok Sabha with numeric suffixes
      urls.filter(u => u.includes('18th-lok-sabha') && u.match(/-\d+$/)),
      
      // Priority 3: 17th Lok Sabha, base name
      urls.filter(u => u.includes('17th-lok-sabha') && !u.match(/-\d+$/)),
      
      // Priority 4: 17th Lok Sabha with numeric suffixes
      urls.filter(u => u.includes('17th-lok-sabha') && u.match(/-\d+$/)),
      
      // Priority 5: 16th Lok Sabha, base name
      urls.filter(u => u.includes('16th-lok-sabha') && !u.match(/-\d+$/)),
      
      // Priority 6: 16th Lok Sabha with numeric suffixes
      urls.filter(u => u.includes('16th-lok-sabha') && u.match(/-\d+$/))
    ];
  } else {
    // For MLAs, simpler priority: base names first, then suffixes
    priorityGroups = [
      urls.filter(u => !u.match(/-\d+$/)), // No numeric suffix
      urls.filter(u => u.match(/-\d+$/))   // With numeric suffix
    ];
  }

  let totalChecked = 0;

  // Check each priority group sequentially
  for (let groupIndex = 0; groupIndex < priorityGroups.length; groupIndex++) {
    const group = priorityGroups[groupIndex];
    
    if (group.length === 0) continue;
    
    console.log(`🔍 [PRS] Priority Group ${groupIndex + 1}/${priorityGroups.length}: Checking ${group.length} URLs`);
    
    // Check this group in parallel (max 8 concurrent)
    const results = await Promise.allSettled(
      group.map((url, index) => 
        limit(async () => {
          try {
            const startTime = Date.now();
            const html = await fetchHTML(url);
            const duration = Date.now() - startTime;
            
            totalChecked++;
            
            if (html && validateMemberPage(html, type)) {
              console.log(`✅ [${totalChecked}/${urls.length}] Found in ${duration}ms - ${url}`);
              return { url, html, success: true, duration };
            }
            
            console.log(`❌ [${totalChecked}/${urls.length}] Invalid (${duration}ms)`);
            return { success: false };
            
          } catch (err) {
            totalChecked++;
            console.log(`❌ [${totalChecked}/${urls.length}] Failed: ${err.message}`);
            return { success: false, error: err.message };
          }
        })
      )
    );
    
    // Check if any succeeded in this group
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        const { url, html, duration } = result.value;
        
        const parsedData = parseToFlatFormat(html, type);
        
        if (parsedData.name && parsedData.name !== 'Unknown') {
          console.log(`🎯 [PRS] SUCCESS! Found in Priority Group ${groupIndex + 1}`);
          console.log(`📊 [PRS] Checked ${totalChecked}/${urls.length} URLs (${duration}ms for match)`);
          
          return {
            found: true,
            data: parsedData,
            sourceUrl: url,
            checkedUrls: totalChecked,
            totalUrls: urls.length
          };
        }
      }
    }
    
    console.log(`⏭️  [PRS] Priority Group ${groupIndex + 1} complete, moving to next group`);
  }

  console.log(`❌ [PRS] No valid pages found among ${totalChecked} URLs checked`);
  return getEmptyResponse();
}

// ============================================================================
// ENHANCED URL CONSTRUCTION WITH DEDUPLICATION & SMART VARIATIONS
// ============================================================================

function constructURLs(name, type, reduced = false) {
  // Normalize and sanitize name
  const nameSlug = name
    .toLowerCase()
    .replace(/\+/g, ' ')         // treat + as space
    .replace(/\./g, '')          // remove dots
    .replace(/\s+/g, '-')        // replace spaces with dashes
    .replace(/[^a-z0-9-]/g, '')  // remove all other special chars
    .replace(/-+/g, '-')         // replace multiple hyphens with single
    .replace(/^-|-$/g, '');      // remove leading/trailing hyphens

  const urlSet = new Set(); // Use Set to avoid duplicates
  const urls = [];
  
  // Helper function to add URL if unique
  const addURL = (url) => {
    if (!urlSet.has(url)) {
      urlSet.add(url);
      urls.push(url);
    }
  };
  
  if (type === 'MP') {
    // For MPs, try 18th, 17th, and 16th Lok Sabha
    const lokSabhas = ['18th-lok-sabha', '17th-lok-sabha', '16th-lok-sabha'];
    const numericSuffixes = ['', '-1', '-2', '-3'];
    
    // Generate all combinations for base name
    for (const sabha of lokSabhas) {
      for (const suffix of numericSuffixes) {
        addURL(`https://prsindia.org/mptrack/${sabha}/${nameSlug}${suffix}`);
      }
    }
    
    // If not reduced, also try name variations
    if (!reduced) {
      const parts = name
        .replace(/\+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(p => p.length > 0);

      // Try first-last for names with 2 or more parts
      if (parts.length >= 2) {
        const firstLast = `${parts[0]}-${parts[parts.length - 1]}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        // Only add if different from original slug
        if (firstLast !== nameSlug && firstLast.length > 0) {
          for (const sabha of lokSabhas) {
            for (const suffix of numericSuffixes) {
              addURL(`https://prsindia.org/mptrack/${sabha}/${firstLast}${suffix}`);
            }
          }
        }
      }

      // Try middle name variations for 3+ part names
      if (parts.length >= 3) {
        // Skip middle name (keep first and last)
        const skipMiddle = [parts[0], parts[parts.length - 1]]
          .join('-')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        const firstLast = `${parts[0]}-${parts[parts.length - 1]}`.toLowerCase();
        
        if (skipMiddle !== nameSlug && skipMiddle !== firstLast && skipMiddle.length > 0) {
          for (const sabha of lokSabhas) {
            addURL(`https://prsindia.org/mptrack/${sabha}/${skipMiddle}`);
          }
        }
        
        // Try first name + middle initial + last name
        if (parts[1].length > 0) {
          const firstInitialLast = `${parts[0]}-${parts[1][0]}-${parts[parts.length - 1]}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          
          if (firstInitialLast !== nameSlug && firstInitialLast.length > 0) {
            for (const sabha of lokSabhas) {
              addURL(`https://prsindia.org/mptrack/${sabha}/${firstInitialLast}`);
            }
          }
        }
      }
    }
    
  } else {
    // For MLAs - no Lok Sabha variations
    const baseURL = 'https://prsindia.org/mlatrack/';
    const numericSuffixes = ['', '-1', '-2', '-3'];
    
    // Base name with suffixes
    for (const suffix of numericSuffixes) {
      addURL(`${baseURL}${nameSlug}${suffix}`);
    }
    
    if (!reduced) {
      const parts = name
        .replace(/\+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(p => p.length > 0);

      // Try first-last for names with 2 or more parts
      if (parts.length >= 2) {
        const firstLast = `${parts[0]}-${parts[parts.length - 1]}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        if (firstLast !== nameSlug && firstLast.length > 0) {
          for (const suffix of numericSuffixes) {
            addURL(`${baseURL}${firstLast}${suffix}`);
          }
        }
      }

      // Try middle name variations for 3+ part names
      if (parts.length >= 3) {
        const skipMiddle = [parts[0], parts[parts.length - 1]]
          .join('-')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        const firstLast = `${parts[0]}-${parts[parts.length - 1]}`.toLowerCase();
        
        if (skipMiddle !== nameSlug && skipMiddle !== firstLast && skipMiddle.length > 0) {
          addURL(`${baseURL}${skipMiddle}`);
        }
      }
    }
  }

  console.log(`🔗 Generated ${urls.length} unique URL variations for "${name}" (${type})`);
  if (urls.length > 0) {
    console.log(`   First: ${urls[0]}`);
    if (urls.length > 1) {
      console.log(`   Last:  ${urls[urls.length - 1]}`);
    }
  }
  
  return urls;
}

// ============================================================================
// IMPROVED VALIDATION WITH ROBUST CHECKS
// ============================================================================

function validateMemberPage(html, type) {
  if (!html || html.length < 500) {
    return false; // Too short to be a real member page
  }

  // Check for "page not found" or error indicators
  const lowerHTML = html.toLowerCase();
  if (lowerHTML.includes('page not found') || 
      lowerHTML.includes('404') || 
      lowerHTML.includes('the requested page') ||
      lowerHTML.includes('no member found')) {
    return false;
  }

  if (type === 'MP') {
    // MP pages should have at least one of these key indicators
    return (
      html.includes('mp-attendance') || 
      html.includes('mp-debate') || 
      html.includes('mp-questions') ||
      html.includes('mp_state') ||
      html.includes('mp_constituency') ||
      html.includes('mptrack')
    );
  } else {
    // MLA pages should have these indicators
    return (
      html.includes('mla_state') || 
      html.includes('mla_constituency') ||
      html.includes('mlatrack') ||
      html.includes('field-name-field-mla-name')
    );
  }
}

// ============================================================================
// PARSE TO EXACT FLAT FORMAT WITH HTML TABLES
// ============================================================================

function parseToFlatFormat(html, type) {
  const $ = cheerio.load(html);
  
  console.log(`📄 [PRS] Parsing to flat format (${type})...`);
  
  // Check if data is available
  const dataNotAvailable = $('.text-center h3').text().includes('Data not available');
  
  if (type === 'MP') {
    return parseMPData($, html, dataNotAvailable);
  } else {
    return parseMLAData($, html, dataNotAvailable);
  }
}

function parseMPData($, html, dataNotAvailable) {
  // Extract all performance metrics with multiple fallback strategies
  const performance = extractParliamentaryPerformance($);
  
  const data = {
    type: 'MP',
    
    // Basic Info
    name: extractName($),
    imageUrl: extractImage($),
    state: extractState($),
    constituency: extractConstituency($),
    party: extractParty($),
    
    // Term Info
    termStart: extractTermStart($),
    termEnd: extractTermEnd($),
    noOfTerm: extractNoOfTerm($),
    membership: extractMembership($),
    
    // Personal Info
    age: extractAge($),
    gender: extractGender($),
    education: extractEducation($),
    
    // Performance Metrics
    ...performance,
    
    // HTML Tables
    attendanceTable: extractAttendanceTable($),
    debatesTable: extractDebatesTable($),
    questionsTable: extractQuestionsTable($)
  };
  
  logDataSummary(data);
  
  return data;
}

function parseMLAData($, html, dataNotAvailable) {
  const data = {
    type: 'MLA',
    
    // Basic Info
    name: extractMLAName($),
    imageUrl: extractMLAImage($),
    state: extractState($),
    constituency: extractMLAConstituency($),
    party: extractParty($),
    
    // Term Info
    termStart: extractMLATermStart($),
    termEnd: extractMLATermEnd($),
    membership: extractMLAMembership($),
    
    // Personal Info
    age: extractMLAAge($),
    gender: extractGender($),
    education: extractMLAEducation($),
    
    // Performance Data (usually not available for MLAs)
    attendance: 'N/A',
    natAttendance: 'N/A',
    stateAttendance: 'N/A',
    debates: 'N/A',
    natDebates: 'N/A',
    stateDebates: 'N/A',
    questions: 'N/A',
    natQuestions: 'N/A',
    stateQuestions: 'N/A',
    pmb: 'N/A',
    natPMB: 'N/A',
    statePMB: 'N/A',
    
    // HTML Tables
    attendanceTable: '',
    debatesTable: '',
    questionsTable: '',
    
    // Note
    note: dataNotAvailable ? 'Data not available' : 'Member data is taken from the election affidavits'
  };
  
  logDataSummary(data);
  
  return data;
}

// ============================================================================
// PARLIAMENTARY PERFORMANCE EXTRACTION - MULTI-STRATEGY APPROACH
// ============================================================================

function extractParliamentaryPerformance($) {
  const metrics = {
    attendance: 'N/A',
    natAttendance: 'N/A',
    stateAttendance: 'N/A',
    debates: 'N/A',
    natDebates: 'N/A',
    stateDebates: 'N/A',
    questions: 'N/A',
    natQuestions: 'N/A',
    stateQuestions: 'N/A',
    pmb: 'N/A',
    natPMB: 'N/A',
    statePMB: 'N/A'
  };

  try {
    console.log('📊 Extracting parliamentary performance metrics...');

    // ========================================
    // STRATEGY 1: Direct field-name selectors
    // ========================================
    
    // ATTENDANCE
    let attendance = $('.mp-attendance .field-name-field-attendance .field-item').first().text().trim();
    let natAttendance = $('.mp-attendance .field-name-field-national-attendance .field-item').first().text().trim();
    let stateAttendance = $('.mp-attendance .field-name-field-state-attendance .field-item').first().text().trim();
    
    // DEBATES
    let debates = $('.mp-debate .field-name-field-author .field-item').first().text().trim();
    let natDebates = $('.mp-debate .field-name-field-national-debate .field-item').first().text().trim();
    let stateDebates = $('.mp-debate .field-name-field-state-debate .field-item').first().text().trim();
    
    // QUESTIONS
    let questions = $('.mp-questions .field-name-field-total-expenses-railway .field-item').first().text().trim();
    let natQuestions = $('.mp-questions .field-name-field-national-questions .field-item').first().text().trim();
    let stateQuestions = $('.mp-questions .field-name-field-state-questions .field-item').first().text().trim();
    
    // PMB
    let pmb = $('.mp-pmb .field-name-field-source .field-item').first().text().trim();
    let natPMB = $('.mp-pmb .field-name-field-national-pmb .field-item').first().text().trim();
    let statePMB = $('.mp-pmb .field-name-field-state-pmb .field-item').first().text().trim();

    // ========================================
    // STRATEGY 2: Fallback - use div.attendance/debate/questions/pmb structure
    // ========================================
    
    if (!attendance || attendance === '') {
      const attItems = $('.mp-attendance .attendance .field-item');
      console.log(`  Fallback: Found ${attItems.length} attendance field-items`);
      if (attItems.length >= 1) attendance = $(attItems[0]).text().trim();
      if (attItems.length >= 2) natAttendance = $(attItems[1]).text().trim();
      if (attItems.length >= 3) stateAttendance = $(attItems[2]).text().trim();
    }
    
    if (!debates || debates === '') {
      const debItems = $('.mp-debate .debate .field-item');
      console.log(`  Fallback: Found ${debItems.length} debate field-items`);
      if (debItems.length >= 1) debates = $(debItems[0]).text().trim();
      if (debItems.length >= 2) natDebates = $(debItems[1]).text().trim();
      if (debItems.length >= 3) stateDebates = $(debItems[2]).text().trim();
    }
    
    if (!questions || questions === '') {
      const qItems = $('.mp-questions .questions .field-item');
      console.log(`  Fallback: Found ${qItems.length} question field-items`);
      if (qItems.length >= 1) questions = $(qItems[0]).text().trim();
      if (qItems.length >= 2) natQuestions = $(qItems[1]).text().trim();
      if (qItems.length >= 3) stateQuestions = $(qItems[2]).text().trim();
    }
    
    if (!pmb || pmb === '') {
      const pmbItems = $('.mp-pmb .pmb .field-item');
      console.log(`  Fallback: Found ${pmbItems.length} PMB field-items`);
      if (pmbItems.length >= 1) pmb = $(pmbItems[0]).text().trim();
      if (pmbItems.length >= 2) natPMB = $(pmbItems[1]).text().trim();
      if (pmbItems.length >= 3) statePMB = $(pmbItems[2]).text().trim();
    }

    // ========================================
    // STRATEGY 3: Parse from span labels
    // ========================================
    
    if (!attendance || attendance === '') {
      $('.mp-attendance span').each((i, elem) => {
        const label = $(elem).text().trim();
        if (label === 'Selected MP') {
          attendance = $(elem).next().find('.field-item').first().text().trim();
        } else if (label === 'National Average') {
          natAttendance = $(elem).next().find('.field-item').first().text().trim();
        } else if (label === 'State Average') {
          stateAttendance = $(elem).next().find('.field-item').first().text().trim();
        }
      });
    }

    // ========================================
    // Assign to metrics object
    // ========================================
    
    if (attendance) {
      metrics.attendance = attendance;
      console.log(`  ✅ Attendance: ${metrics.attendance}`);
    }
    if (natAttendance) {
      metrics.natAttendance = natAttendance;
      console.log(`  ✅ National Attendance: ${metrics.natAttendance}`);
    }
    if (stateAttendance) {
      metrics.stateAttendance = stateAttendance;
      console.log(`  ✅ State Attendance: ${metrics.stateAttendance}`);
    }

    if (debates) {
      metrics.debates = debates;
      console.log(`  ✅ Debates: ${metrics.debates}`);
    }
    if (natDebates) {
      metrics.natDebates = natDebates;
      console.log(`  ✅ National Debates: ${metrics.natDebates}`);
    }
    if (stateDebates) {
      metrics.stateDebates = stateDebates;
      console.log(`  ✅ State Debates: ${metrics.stateDebates}`);
    }

    if (questions) {
      metrics.questions = questions;
      console.log(`  ✅ Questions: ${metrics.questions}`);
    }
    if (natQuestions) {
      metrics.natQuestions = natQuestions;
      console.log(`  ✅ National Questions: ${metrics.natQuestions}`);
    }
    if (stateQuestions) {
      metrics.stateQuestions = stateQuestions;
      console.log(`  ✅ State Questions: ${metrics.stateQuestions}`);
    }

    if (pmb) {
      metrics.pmb = pmb || '0';
      console.log(`  ✅ PMB: ${metrics.pmb}`);
    } else {
      metrics.pmb = '0';
    }
    
    if (natPMB) {
      metrics.natPMB = natPMB || '0';
      console.log(`  ✅ National PMB: ${metrics.natPMB}`);
    } else {
      metrics.natPMB = '0';
    }
    
    if (statePMB && statePMB !== '') {
      metrics.statePMB = statePMB;
      console.log(`  ✅ State PMB: ${metrics.statePMB}`);
    } else {
      metrics.statePMB = 'N/A';
    }

    console.log('📊 Final extracted metrics:', metrics);
    
    // Log the HTML structure for debugging if nothing was found
    if (metrics.attendance === 'N/A') {
      console.log('⚠️ WARNING: No performance data extracted!');
      console.log('HTML structure of .mp-attendance:');
      console.log($('.mp-attendance').html()?.substring(0, 500));
    }
    
  } catch (e) {
    console.error('❌ Error extracting parliamentary performance:', e);
  }

  return metrics;
}

// ============================================================================
// BASIC INFO EXTRACTION FUNCTIONS
// ============================================================================

function extractName($) {
  try {
    const name = $('.mp-name h1 a, .mp-name h1, .field-name-title-field .field-item').first().text().trim();
    if (name) return name;
  } catch (e) {}
  return 'Unknown';
}

function extractImage($) {
  try {
    const img = $('.field-name-field-image img').first().attr('src');
    if (img) {
      return img.startsWith('http') ? img : `https://prsindia.org${img}`;
    }
  } catch (e) {}
  return '';
}

function extractState($) {
  try {
    let foundState = 'Unknown';
    $('.mp_state, .mla_state').each((i, elem) => {
      const label = $(elem).find('.field-label').text();
      if (label.includes('State')) {
        const stateText = $(elem).find('a').text().trim();
        if (stateText) {
          foundState = stateText.replace(/\(\s*\d+\s*more\s*(MPs?|MLAs?)\s*\)/gi, '').trim();
          return false;
        }
      }
    });
    return foundState;
  } catch (e) {}
  return 'Unknown';
}

function extractConstituency($) {
  try {
    const constituency = $('.mp_constituency').first().text().replace('Constituency :', '').trim();
    if (constituency) return constituency;
  } catch (e) {}
  return 'Unknown';
}

function extractParty($) {
  try {
    let foundParty = 'Unknown';
    $('.mp_state, .mla_state').each((i, elem) => {
      const label = $(elem).find('.field-label').text();
      if (label.includes('Party')) {
        const partyText = $(elem).find('a').text().trim();
        if (partyText) {
          foundParty = partyText.replace(/\(\s*\d+\s*more\s*(MPs?|MLAs?)\s*\)/gi, '').trim();
          return false;
        }
      }
    });
    return foundParty;
  } catch (e) {}
  return 'Unknown';
}

function extractTermStart($) {
  try {
    const start = $('.term_start .field-name-field-date-of-introduction .field-item').text().trim();
    if (start) return start;
  } catch (e) {}
  return 'N/A';
}

function extractTermEnd($) {
  try {
    const end = $('.term_end').first().text().replace('End of Term :', '').trim();
    if (end) return end;
  } catch (e) {}
  return 'N/A';
}

function extractNoOfTerm($) {
  try {
    let termNo = 'N/A';
    $('.age, .mp-basic-info > div').each((i, elem) => {
      const label = $(elem).find('.field-label').text();
      if (label.includes('No. of Term')) {
        termNo = $(elem).text().replace(label, '').trim();
        return false;
      }
    });
    return termNo;
  } catch (e) {}
  return 'N/A';
}

function extractMembership($) {
  try {
    let membership = 'N/A';
    $('.age, .mp-basic-info > div').each((i, elem) => {
      const label = $(elem).find('.field-label').text();
      if (label.includes('Nature of membership')) {
        membership = $(elem).text().replace(label, '').trim();
        return false;
      }
    });
    return membership;
  } catch (e) {}
  return 'N/A';
}

function extractAge($) {
  try {
    const age = $('.personal_profile_parent .gender .field-label:contains("Age")').parent().text().replace('Age :', '').trim();
    if (age) return age;
  } catch (e) {}
  return 'N/A';
}

function extractGender($) {
  try {
    const gender = $('.personal_profile_parent .gender .field-label:contains("Gender")').parent().find('a').text().trim();
    if (gender) return gender;
  } catch (e) {}
  return 'N/A';
}

function extractEducation($) {
  try {
    const edu = $('.personal_profile_parent .education .field-label:contains("Education")').parent().find('a').text().trim();
    if (edu) return edu;
  } catch (e) {}
  return 'N/A';
}

// ============================================================================
// MLA SPECIFIC EXTRACTION FUNCTIONS
// ============================================================================

function extractMLAName($) {
  return extractName($);
}

function extractMLAImage($) {
  return extractImage($);
}

function extractMLAConstituency($) {
  try {
    const constituency = $('.mla_constituency, .mp_constituency').first().text().replace('Constituency :', '').trim();
    if (constituency) return constituency;
  } catch (e) {}
  return 'Unknown';
}

function extractMLATermStart($) {
  return extractTermStart($);
}

function extractMLATermEnd($) {
  return extractTermEnd($);
}

function extractMLAMembership($) {
  return extractMembership($);
}

function extractMLAAge($) {
  return extractAge($);
}

function extractMLAEducation($) {
  return extractEducation($);
}

// ============================================================================
// HTML TABLE EXTRACTION
// ============================================================================

// ============================================================================
// HTML TABLE EXTRACTION - FIXED SELECTORS
// ============================================================================

function extractAttendanceTable($) {
  try {
    // Correct selector based on actual HTML structure
    let table = $('#block-views-mps-attendance-block table').first();
    
    // Fallback to old selector if needed
    if (!table.length) {
      table = $('#block-views-mp-related-views-block-1 table').first();
    }
    
    if (table.length) {
      console.log(`  ✅ Attendance table extracted (${table.find('tr').length} rows)`);
      return $.html(table);
    }
    
    console.log(`  ⚠️ Attendance table not found`);
  } catch (e) {
    console.error(`  ❌ Error extracting attendance table:`, e.message);
  }
  return '';
}

function extractDebatesTable($) {
  try {
    // Correct selector based on actual HTML structure
    let table = $('#block-views-mps-debate-related-views-block table').first();
    
    // Fallback to old selector if needed
    if (!table.length) {
      table = $('#block-views-mp-related-views-block table').first();
    }
    
    if (table.length) {
      console.log(`  ✅ Debates table extracted (${table.find('tr').length} rows)`);
      return $.html(table);
    }
    
    console.log(`  ⚠️ Debates table not found`);
  } catch (e) {
    console.error(`  ❌ Error extracting debates table:`, e.message);
  }
  return '';
}

function extractQuestionsTable($) {
  try {
    // Try multiple possible selectors for questions
    let table = $('#block-views-mps-questions-block table').first();
    
    if (!table.length) {
      table = $('#block-views-mp-questions-block table').first();
    }
    
    if (!table.length) {
      table = $('#block-views-mp-related-views-block-2 table').first();
    }
    
    // Also try finding any section with "questions" in the heading
    if (!table.length) {
      $('section[id*="question"]').each((i, section) => {
        const sectionTable = $(section).find('table').first();
        if (sectionTable.length) {
          table = sectionTable;
          return false; // break loop
        }
      });
    }
    
    if (table.length) {
      console.log(`  ✅ Questions table extracted (${table.find('tr').length} rows)`);
      return $.html(table);
    }
    
    console.log(`  ⚠️ Questions table not found`);
  } catch (e) {
    console.error(`  ❌ Error extracting questions table:`, e.message);
  }
  return '';
}
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getEmptyResponse() {
  return {
    found: false,
    data: {
      type: 'Unknown',
      name: 'Unknown',
      imageUrl: '',
      state: 'N/A',
      constituency: 'N/A',
      party: 'N/A',
      termStart: 'N/A',
      termEnd: 'N/A',
      age: 'N/A',
      gender: 'N/A',
      education: 'N/A',
      attendance: 'N/A',
      natAttendance: 'N/A',
      stateAttendance: 'N/A',
      debates: 'N/A',
      natDebates: 'N/A',
      stateDebates: 'N/A',
      questions: 'N/A',
      natQuestions: 'N/A',
      stateQuestions: 'N/A',
      pmb: 'N/A',
      natPMB: 'N/A',
      statePMB: 'N/A',
      attendanceTable: '',
      debatesTable: '',
      questionsTable: ''
    }
  };
}

function logDataSummary(data) {
  console.log('📋 Extracted Data Summary:');
  console.log(`   Name: ${data.name}`);
  console.log(`   Type: ${data.type}`);
  console.log(`   State: ${data.state}`);
  console.log(`   Constituency: ${data.constituency}`);
  console.log(`   Party: ${data.party}`);
  console.log(`   Attendance: ${data.attendance} (Nat: ${data.natAttendance}, State: ${data.stateAttendance})`);
  console.log(`   Debates: ${data.debates} (Nat: ${data.natDebates}, State: ${data.stateDebates})`);
  console.log(`   Questions: ${data.questions} (Nat: ${data.natQuestions}, State: ${data.stateQuestions})`);
  console.log(`   PMB: ${data.pmb} (Nat: ${data.natPMB}, State: ${data.statePMB})`);
}
