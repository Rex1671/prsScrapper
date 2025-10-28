// src/prsService.js - Returns data in exact required format
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

async function tryFetchWithType(name, type, reduced = false) {
  const urls = constructURLs(name, type, reduced);
  
  console.log(`🔗 [PRS] Checking ${urls.length} URLs in parallel`);

  const fetchPromises = urls.map((url, index) => 
    limit(async () => {
      try {
        const startTime = Date.now();
        const html = await fetchHTML(url);
        const duration = Date.now() - startTime;
        
        if (html && html.length > 1000 && validateMemberPage(html, type)) {
          console.log(`✅ [${index}] Found in ${duration}ms`);
          return { url, html, success: true, duration };
        }
        
        return { url, html: null, success: false };
        
      } catch (err) {
        return { url, html: null, success: false };
      }
    })
  );

  const results = await Promise.allSettled(fetchPromises);
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.success) {
      const { url, html } = result.value;
      
      const parsedData = parseToFlatFormat(html, type);
      
      if (parsedData.name && parsedData.name !== 'Unknown') {
        console.log(`✅ [PRS] Successfully parsed: ${parsedData.name}`);
        return {
          found: true,
          data: parsedData
        };
      }
    }
  }

  return getEmptyResponse();
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
  // Extract all performance metrics at once
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
    
    // Performance Metrics (from the extracted performance object)
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
    
    // HTML Tables (usually empty for MLAs)
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
// PARLIAMENTARY PERFORMANCE EXTRACTION - FIXED LOGIC
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

    // ATTENDANCE - Using specific field-name classes
    const attendance = $('.mp-attendance .field-name-field-attendance .field-item').first().text().trim();
    const natAttendance = $('.mp-attendance .field-name-field-national-attendance .field-item').first().text().trim();
    const stateAttendance = $('.mp-attendance .field-name-field-state-attendance .field-item').first().text().trim();
    
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

    // DEBATES - Using specific field-name classes
    const debates = $('.mp-debate .field-name-field-author .field-item').first().text().trim();
    const natDebates = $('.mp-debate .field-name-field-national-debate .field-item').first().text().trim();
    const stateDebates = $('.mp-debate .field-name-field-state-debate .field-item').first().text().trim();
    
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

    // QUESTIONS - Using specific field-name classes
    const questions = $('.mp-questions .field-name-field-total-expenses-railway .field-item').first().text().trim();
    const natQuestions = $('.mp-questions .field-name-field-national-questions .field-item').first().text().trim();
    const stateQuestions = $('.mp-questions .field-name-field-state-questions .field-item').first().text().trim();
    
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

    // PRIVATE MEMBER'S BILLS - Using specific field-name classes
    const pmb = $('.mp-pmb .field-name-field-source .field-item').first().text().trim();
    const natPMB = $('.mp-pmb .field-name-field-national-pmb .field-item').first().text().trim();
    const statePMB = $('.mp-pmb .field-name-field-state-pmb .field-item').first().text().trim();
    
    if (pmb) {
      metrics.pmb = pmb;
      console.log(`  ✅ PMB: ${metrics.pmb}`);
    } else {
      metrics.pmb = '0';
    }
    
    if (natPMB) {
      metrics.natPMB = natPMB;
      console.log(`  ✅ National PMB: ${metrics.natPMB}`);
    } else {
      metrics.natPMB = '0';
    }
    
    if (statePMB) {
      metrics.statePMB = statePMB;
      console.log(`  ✅ State PMB: ${metrics.statePMB}`);
    } else {
      metrics.statePMB = 'N/A';
    }

    console.log('📊 Final extracted metrics:', metrics);
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

function extractAttendanceTable($) {
  try {
    const table = $('#block-views-mp-related-views-block-1 table').first();
    if (table.length) {
      return $.html(table);
    }
  } catch (e) {}
  return '';
}

function extractDebatesTable($) {
  try {
    const table = $('#block-views-mp-related-views-block table').first();
    if (table.length) {
      return $.html(table);
    }
  } catch (e) {}
  return '';
}

function extractQuestionsTable($) {
  try {
    const table = $('#block-views-mp-related-views-block-2 table').first();
    if (table.length) {
      return $.html(table);
    }
  } catch (e) {}
  return '';
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function constructURLs(name, type, reduced = false) {
  const nameSlug = name.toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  
  const urls = [];
  const baseURL = type === 'MP' 
    ? 'https://prsindia.org/mptrack/18th-lok-sabha/'
    : 'https://prsindia.org/mlatrack/';
  
  urls.push(`${baseURL}${nameSlug}`);
  
  if (!reduced) {
    const parts = name.split(' ');
    if (parts.length > 2) {
      const firstLast = `${parts[0]}-${parts[parts.length - 1]}`.toLowerCase();
      urls.push(`${baseURL}${firstLast}`);
    }
  }
  
  return urls;
}

function validateMemberPage(html, type) {
  if (type === 'MP') {
    return html.includes('mp-attendance') || html.includes('mp-debate') || html.includes('mp_state');
  } else {
    return html.includes('mla_state') || html.includes('mla_constituency');
  }
}

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
