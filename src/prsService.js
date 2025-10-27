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
    attendance: extractMPAttendance($),
    natAttendance: extractNationalAttendance($),
    stateAttendance: extractStateAttendance($),
    
    debates: extractMPDebates($),
    natDebates: extractNationalDebates($),
    stateDebates: extractStateDebates($),
    
    questions: extractMPQuestions($),
    natQuestions: extractNationalQuestions($),
    stateQuestions: extractStateQuestions($),
    
    pmb: extractMPPMB($),
    natPMB: extractNationalPMB($),
    statePMB: extractStatePMB($),
    
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
// MP EXTRACTION FUNCTIONS
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

function extractMPAttendance($) {
  try {
    const att = $('.mp-attendance .field-name-field-attendance .field-item').text().trim();
    return att || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractNationalAttendance($) {
  try {
    const att = $('.mp-attendance .field-name-field-national-attendance .field-item').text().trim();
    return att || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractStateAttendance($) {
  try {
    const att = $('.mp-attendance .field-name-field-state-attendance .field-item').text().trim();
    return att || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractMPDebates($) {
  try {
    const deb = $('.mp-debate .field-name-field-author .field-item').text().trim();
    return deb || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractNationalDebates($) {
  try {
    const deb = $('.mp-debate .field-name-field-national-debate .field-item').text().trim();
    return deb || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractStateDebates($) {
  try {
    const deb = $('.mp-debate .field-name-field-state-debate .field-item').text().trim();
    return deb || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractMPQuestions($) {
  try {
    const q = $('.mp-questions .field-name-field-total-expenses-railway .field-item').text().trim();
    return q || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractNationalQuestions($) {
  try {
    const q = $('.mp-questions .field-name-field-national-questions .field-item').text().trim();
    return q || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractStateQuestions($) {
  try {
    const q = $('.mp-questions .field-name-field-state-questions .field-item').text().trim();
    return q || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractMPPMB($) {
  try {
    const pmb = $('.mp-pmb .field-name-field-source .field-item').text().trim();
    return pmb !== undefined && pmb !== '' ? pmb : 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractNationalPMB($) {
  try {
    const pmb = $('.mp-pmb .field-name-field-national-pmb .field-item').text().trim();
    return pmb || 'N/A';
  } catch (e) {}
  return 'N/A';
}

function extractStatePMB($) {
  try {
    const pmb = $('.mp-pmb .field-name-field-state-pmb .field-item').text().trim();
    return pmb || 'N/A';
  } catch (e) {}
  return 'N/A';
}

// ============================================================================
// HTML TABLE EXTRACTION
// ============================================================================

function extractAttendanceTable($) {
  try {
    const table = $('#block-views-mps-attendance-block table');
    if (table.length) {
      return table.prop('outerHTML') || '';
    }
  } catch (e) {}
  return '';
}

function extractDebatesTable($) {
  try {
    const table = $('#block-views-mps-debate-related-views-block table');
    if (table.length) {
      return table.prop('outerHTML') || '';
    }
  } catch (e) {}
  return '';
}

function extractQuestionsTable($) {
  try {
    const table = $('#block-views-mp-related-views-block-2222 table');
    if (table.length) {
      return table.prop('outerHTML') || '';
    }
  } catch (e) {}
  return '';
}

// ============================================================================
// MLA EXTRACTION FUNCTIONS
// ============================================================================

function extractMLAName($) {
  try {
    const name = $('.mla-name h3 .field-name-title-field .field-item, .field-name-title-field .field-item').first().text().trim();
    if (name) return name;
  } catch (e) {}
  return 'Unknown';
}

function extractMLAImage($) {
  try {
    const img = $('.field-name-field-mla-profile-image img').first().attr('src');
    if (img) {
      return img.startsWith('http') ? img : `https://prsindia.org${img}`;
    }
  } catch (e) {}
  return '';
}

function extractMLAConstituency($) {
  try {
    const constituency = $('.mp_constituency .field-name-field-mla-constituency .field-item').text().trim();
    if (constituency) return constituency;
  } catch (e) {}
  return 'Unknown';
}

function extractMLATermStart($) {
  try {
    const start = $('.term_end .field-label:contains("Start Of Term")').parent().find('.field-item').text().trim();
    if (start) return start;
  } catch (e) {}
  return 'N/A';
}

function extractMLATermEnd($) {
  try {
    let end = 'N/A';
    $('.term_end').each((i, elem) => {
      const label = $(elem).find('.field-label').text();
      if (label.includes('End Of Term')) {
        end = $(elem).find('.field-item').text().trim();
        return false;
      }
    });
    return end;
  } catch (e) {}
  return 'N/A';
}

function extractMLAMembership($) {
  try {
    const membership = $('.membership .field-name-field-membership .field-item').text().trim();
    if (membership) return membership;
  } catch (e) {}
  return 'N/A';
}

function extractMLAAge($) {
  try {
    const age = $('.personal_profile_parent .age .field-name-field-mla-age .field-item').text().trim();
    if (age) return age;
  } catch (e) {}
  return 'N/A';
}

function extractMLAEducation($) {
  try {
    const edu = $('.personal_profile_parent .education a').text().trim();
    if (edu) return edu;
  } catch (e) {}
  return 'N/A';
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function validateMemberPage(html, type) {
  if (type === 'MP') {
    const indicators = ['mp_profile_header_info', 'mp-parliamentary-performance', 'mp_state'];
    return indicators.filter(i => html.includes(i)).length >= 2;
  } else {
    const indicators = ['mla-name', 'field-name-field-mla-profile-image', 'mp_state'];
    return indicators.filter(i => html.includes(i)).length >= 1;
  }
}

function logDataSummary(data) {
  console.log(`\n📊 ========== DATA EXTRACTED ==========`);
  console.log(`Type: ${data.type}`);
  console.log(`Name: ${data.name}`);
  console.log(`Party: ${data.party}`);
  console.log(`Constituency: ${data.constituency}`);
  console.log(`State: ${data.state}`);
  console.log(`Attendance: ${data.attendance}`);
  console.log(`Debates: ${data.debates}`);
  console.log(`Questions: ${data.questions}`);
  console.log(`Tables: Attendance=${!!data.attendanceTable}, Debates=${!!data.debatesTable}, Questions=${!!data.questionsTable}`);
  console.log(`======================================\n`);
}

function constructURLs(name, type, reduced = false) {
  const slugs = generateNameSlugs(name);
  const urls = [];

  if (type === 'MP') {
    const sessions = reduced ? ['18th-lok-sabha'] : ['18th-lok-sabha', '17th-lok-sabha', '16th-lok-sabha'];
    
    for (const session of sessions) {
      for (const slug of slugs) {
        urls.push(`https://prsindia.org/mptrack/${session}/${slug}`);
      }
    }

    if (!reduced) {
      for (const session of sessions.slice(0, 2)) {
        for (const slug of slugs) {
          urls.push(`https://prsindia.org/mptrack/${session}/${slug}-1`);
          urls.push(`https://prsindia.org/mptrack/${session}/${slug}-2`);
        }
      }
    }
  } else if (type === 'MLA') {
    for (const slug of slugs) {
      urls.push(`https://prsindia.org/mlatrack/${slug}`);
    }
    
    if (!reduced) {
      for (const slug of slugs) {
        urls.push(`https://prsindia.org/mlatrack/${slug}-1`);
        urls.push(`https://prsindia.org/mlatrack/${slug}-2`);
        urls.push(`https://prsindia.org/mlatrack/${slug}-3`);
      }
    }
  }

  return reduced ? urls.slice(0, 5) : urls;
}

function generateNameSlugs(name) {
  const slugs = [];

  let cleanName = name
    .trim()
    .toLowerCase()
    .replace(/^(dr\.?|shri|smt\.?|prof\.?|mr\.?|mrs\.?|ms\.?|s\.?|sh\.?)\s+/gi, '')
    .replace(/[+_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const basicSlug = cleanName.replace(/\s+/g, '-');
  slugs.push(basicSlug);

  const parts = cleanName.split(' ');
  
  if (parts.length > 2) {
    slugs.push(`${parts[0]}-${parts[parts.length - 1]}`);
  }

  if (parts.length > 3) {
    slugs.push(`${parts[0]}-${parts[1]}-${parts[parts.length - 1]}`);
  }

  return [...new Set(slugs)];
}

function getEmptyResponse() {
  return {
    found: false,
    data: {
      type: 'Unknown',
      name: 'Unknown',
      imageUrl: '',
      state: 'Unknown',
      constituency: 'Unknown',
      party: 'Unknown',
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
      questionsTable: ''
    }
  };
}