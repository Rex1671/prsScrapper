// src/prsService.js - UPDATED VERSION with Enhanced Error Handling
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchHTML } from './webextract.js';

const limit = pLimit(8);

export async function getPRSData(name, type, constituency = null, state = null) {
  console.log(`🔍 [PRS] Fetching ${name} (${type})`);
  
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

async function tryFetchWithType(name, type, reduced = false) {
  const urls = constructURLs(name, type, reduced);
  const urlsChecked = [];
  
  console.log(`🔗 [PRS] Checking ${urls.length} URLs in parallel`);

  const fetchPromises = urls.map((url, index) =>
    limit(async () => {
      urlsChecked.push(url);
      try {
        const startTime = Date.now();
        const html = await fetchHTML(url);
        const duration = Date.now() - startTime;
        
        if (html && html.length > 1000 && validateMemberPage(html, type)) {
          console.log(`✅ [${index}] Found in ${duration}ms - URL: ${url}`);
          return { url, html, success: true, duration };
        }
        
        console.log(`❌ [${index}] Invalid page or not found - URL: ${url}`);
        return { url, html: null, success: false };
        
      } catch (err) {
        console.error(`❌ [${index}] Error fetching ${url}: ${err.message}`);
        return { url, html: null, success: false, error: err.message };
      }
    })
  );

  try {
    const results = await Promise.allSettled(fetchPromises);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        const { url, html } = result.value;
        
        try {
          const parsedData = parseToFlatFormat(html, type);
          
          if (parsedData.name && parsedData.name !== 'Unknown') {
            console.log(`✅ [PRS] Successfully parsed: ${parsedData.name}`);
            return {
              found: true,
              data: parsedData,
              urlsChecked,
              sourceUrl: url
            };
          }
        } catch (parseError) {
          console.error(`❌ Error parsing HTML from ${url}: ${parseError.message}`);
        }
      }
    }

    return { 
      ...getEmptyResponse(), 
      urlsChecked 
    };
    
  } catch (err) {
    console.error(`❌ Error in tryFetchWithType: ${err.message}`);
    throw err;
  }
}

// ============================================================================
// PARSE TO EXACT FLAT FORMAT WITH HTML TABLES
// ============================================================================

function parseToFlatFormat(html, type) {
  try {
    const $ = cheerio.load(html);
    
    console.log(`📄 [PRS] Parsing to flat format (${type})...`);
    
    // Check if data is available
    const dataNotAvailable = $('.text-center h3').text().includes('Data not available');
    
    if (type === 'MP') {
      return parseMPData($, html, dataNotAvailable);
    } else {
      return parseMLAData($, html, dataNotAvailable);
    }
  } catch (error) {
    console.error(`❌ Error in parseToFlatFormat: ${error.message}`);
    throw error;
  }
}

function parseMPData($, html, dataNotAvailable) {
  try {
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
      questionsTable: extractQuestionsTable($),
      
      // Metadata
      dataAvailable: !dataNotAvailable,
      extractedAt: new Date().toISOString()
    };
    
    logDataSummary(data);
    
    return data;
  } catch (error) {
    console.error(`❌ Error in parseMPData: ${error.message}`);
    throw error;
  }
}

function parseMLAData($, html, dataNotAvailable) {
  try {
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
      noOfTerm: extractNoOfTerm($),
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
      
      // Metadata
      dataAvailable: !dataNotAvailable,
      note: dataNotAvailable ? 'Data not available' : 'Member data is taken from the election affidavits',
      extractedAt: new Date().toISOString()
    };
    
    logDataSummary(data);
    
    return data;
  } catch (error) {
    console.error(`❌ Error in parseMLAData: ${error.message}`);
    throw error;
  }
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
    console.error('❌ Error extracting parliamentary performance:', e.message);
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
  } catch (e) {
    console.error('Error extracting name:', e.message);
  }
  return 'Unknown';
}

function extractImage($) {
  try {
    const img = $('.field-name-field-image img').first().attr('src');
    if (img) {
      return img.startsWith('http') ? img : `https://prsindia.org${img}`;
    }
  } catch (e) {
    console.error('Error extracting image:', e.message);
  }
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
          foundState = stateText.replace(/\s*\d+\s*more\s*(MPs?|MLAs?)\s*/gi, '').trim();
          return false;
        }
      }
    });
    return foundState;
  } catch (e) {
    console.error('Error extracting state:', e.message);
  }
  return 'Unknown';
}

function extractConstituency($) {
  try {
    const constituency = $('.mp_constituency').first().text().replace('Constituency :', '').trim();
    if (constituency) return constituency;
  } catch (e) {
    console.error('Error extracting constituency:', e.message);
  }
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
          foundParty = partyText.replace(/\s*\d+\s*more\s*(MPs?|MLAs?)\s*/gi, '').trim();
          return false;
        }
      }
    });
    return foundParty;
  } catch (e) {
    console.error('Error extracting party:', e.message);
  }
  return 'Unknown';
}

function extractTermStart($) {
  try {
    const start = $('.term_start .field-name-field-date-of-introduction .field-item').text().trim();
    if (start) return start;
  } catch (e) {
    console.error('Error extracting term start:', e.message);
  }
  return 'N/A';
}

function extractTermEnd($) {
  try {
    const end = $('.term_end').first().text().replace('End of Term :', '').trim();
    if (end) return end;
  } catch (e) {
    console.error('Error extracting term end:', e.message);
  }
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
  } catch (e) {
    console.error('Error extracting number of terms:', e.message);
  }
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
  } catch (e) {
    console.error('Error extracting membership:', e.message);
  }
  return 'N/A';
}

function extractAge($) {
  try {
    const age = $('.personal_profile_parent .gender .field-label:contains("Age")').parent().text().replace('Age :', '').trim();
    if (age) return age;
  } catch (e) {
    console.error('Error extracting age:', e.message);
  }
  return 'N/A';
}

function extractGender($) {
  try {
    const gender = $('.personal_profile_parent .gender .field-label:contains("Gender")').parent().find('a').text().trim();
    if (gender) return gender;
  } catch (e) {
    console.error('Error extracting gender:', e.message);
  }
  return 'N/A';
}

function extractEducation($) {
  try {
    const edu = $('.personal_profile_parent .education .field-label:contains("Education")').parent().find('a').text().trim();
    if (edu) return edu;
  } catch (e) {
    console.error('Error extracting education:', e.message);
  }
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
  } catch (e) {
    console.error('Error extracting MLA constituency:', e.message);
  }
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
  } catch (e) {
    console.error('Error extracting attendance table:', e.message);
  }
  return '';
}

function extractDebatesTable($) {
  try {
    const table = $('#block-views-mp-related-views-block table').first();
    if (table.length) {
      return $.html(table);
    }
  } catch (e) {
    console.error('Error extracting debates table:', e.message);
  }
  return '';
}

function extractQuestionsTable($) {
  try {
    const table = $('#block-views-mp-related-views-block-2 table').first();
    if (table.length) {
      return $.html(table);
    }
  } catch (e) {
    console.error('Error extracting questions table:', e.message);
  }
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
    
    // Try without middle names
    if (parts.length === 3) {
      const firstThird = `${parts[0]}-${parts[2]}`.toLowerCase();
      urls.push(`${baseURL}${firstThird}`);
    }
  }
  
  return urls;
}

function validateMemberPage(html, type) {
  try {
    if (type === 'MP') {
      return html.includes('mp-attendance') || 
             html.includes('mp-debate') || 
             html.includes('mp_state') ||
             html.includes('mp-name');
    } else {
      return html.includes('mla_state') || 
             html.includes('mla_constituency') ||
             html.includes('mla-name');
    }
  } catch (e) {
    console.error('Error validating member page:', e.message);
    return false;
  }
}

function getEmptyResponse() {
  return {
    found: false,
    urlsChecked: [],
    data: {
      type: 'Unknown',
      name: 'Unknown',
      imageUrl: '',
      state: 'N/A',
      constituency: 'N/A',
      party: 'N/A',
      termStart: 'N/A',
      termEnd: 'N/A',
      noOfTerm: 'N/A',
      membership: 'N/A',
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
      questionsTable: '',
      dataAvailable: false,
      extractedAt: new Date().toISOString()
    }
  };
}

function logDataSummary(data) {
  console.log('📋 Extracted Data Summary:');
  console.log(`  Name: ${data.name}`);
  console.log(`  Type: ${data.type}`);
  console.log(`  State: ${data.state}`);
  console.log(`  Constituency: ${data.constituency}`);
  console.log(`  Party: 
