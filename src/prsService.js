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
// PARLIAMENTARY PERFORMANCE EXTRACTION - ALL METRICS AT ONCE
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

    // Attendance - Extract all field-items from mp-attendance section
    const attItems = $('.mp-attendance .field-item');
    console.log(`  Found ${attItems.length} attendance items`);
    
    if (attItems.length >= 3) {
      metrics.attendance = $(attItems[0]).text().trim();
      metrics.natAttendance = $(attItems[1]).text().trim();
      metrics.stateAttendance = $(attItems[2]).text().trim();
      
      console.log(`  ✅ Attendance: ${metrics.attendance}`);
      console.log(`  ✅ National Attendance: ${metrics.natAttendance}`);
      console.log(`  ✅ State Attendance: ${metrics.stateAttendance}`);
    } else {
      console.log('  ⚠️ Not enough attendance items found');
    }

    // Debates - Extract all field-items from mp-debate section
    const debItems = $('.mp-debate .field-item');
    console.log(`  Found ${debItems.length} debate items`);
    
    if (debItems.length >= 3) {
      metrics.debates = $(debItems[0]).text().trim();
      metrics.natDebates = $(debItems[1]).text().trim();
      metrics.stateDebates = $(debItems[2]).text().trim();
      
      console.log(`  ✅ Debates: ${metrics.debates}`);
      console.log(`  ✅ National Debates: ${metrics.natDebates}`);
      console.log(`  ✅ State Debates: ${metrics.stateDebates}`);
    } else {
      console.log('  ⚠️ Not enough debate items found');
    }

    // Questions - Extract all field-items from mp-questions section
    const qItems = $('.mp-questions .field-item');
    console.log(`  Found ${qItems.length} question items`);
    
    if (qItems.length >= 3) {
      metrics.questions = $(qItems[0]).text().trim();
      metrics.natQuestions = $(qItems[1]).text().trim();
      metrics.stateQuestions = $(qItems[2]).text().trim();
      
      console.log(`  ✅ Questions: ${metrics.questions}`);
      console.log(`  ✅ National Questions: ${metrics.natQuestions}`);
      console.log(`  ✅ State Questions: ${metrics.stateQuestions}`);
    } else {
      console.log('  ⚠️ Not enough question items found');
    }

    // PMB (Private Member Bills) - Extract all field-items from mp-pmb section
    const pmbItems = $('.mp-pmb .field-item');
    console.log(`  Found ${pmbItems.length} PMB items`);
    
    if (pmbItems.length >= 2) {
      const pmbValue = $(pmbItems[0]).text().trim();
      const natPMBValue = $(pmbItems[1]).text().trim();
      
      metrics.pmb = pmbValue !== '' ? pmbValue : '0';
      metrics.natPMB = natPMBValue !== '' ? natPMBValue : '0';
      
      if (pmbItems.length >= 3) {
        const statePMBValue = $(pmbItems[2]).text().trim();
        metrics.statePMB = statePMBValue !== '' ? statePMBValue : 'N/A';
      }
      
      console.log(`  ✅ PMB: ${metrics.pmb}`);
      console.log(`  ✅ National PMB: ${metrics.natPMB}`);
      console.log(`  ✅ State PMB: ${metrics.statePMB}`);
    } else {
      console.log('  ⚠️ Not enough PMB items found');
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
// HTML TABLE EXTRACTION
// ============================================================================

function extractAttendanceTable
