/**
 * Post Pre-Filter — deterministic rejection before AI pipeline
 *
 * Catches posts that should be rejected BEFORE sending to the AI pipeline,
 * saving API calls. Also used as a safety net in Phase 2 scoring.
 *
 * Categories:
 *  1. Non-India locations (US, Pakistan, ME, SE Asia, Europe, etc.)
 *  2. F2F / walk-in interviews
 *  3. Local candidates only restrictions
 *  4. Internship / stipend / unpaid
 *  5. Job seekers (#OpenToWork, "looking for job")
 *  6. Low salary (< 6 LPA)
 *  7. Staffing / recruitment agency posts (not actual jobs)
 *
 * Built from analysis of ~2000 posts across the pipeline.
 */

// ============================================================
// 1. LOCATION PATTERNS
// ============================================================

const LOCATION_PATTERNS = {
  usCities: /\b(San Diego|San Francisco|San Jose|New York|NYC|Chicago|Los Angeles|Seattle|Austin|Dallas|Houston|Plano|Boston|Denver|Atlanta|Phoenix|Portland|Raleigh|Charlotte|Arlington|Tampa|Miami|Orlando|Minneapolis|Detroit|Philadelphia|Pittsburgh|Nashville|Las Vegas|Sacramento|Irvine|Sunnyvale|Mountain View|Palo Alto|Cupertino|Redmond|Bellevue|Ann Arbor|Boulder|Scottsdale|Boise|Salt Lake City|St\.? Louis|San Antonio|Columbus|Indianapolis|Jacksonville|Memphis|Louisville|Richmond|Omaha|Tucson|Fresno|Mesa)\b/i,
  usStates: /\b(California|Texas|Florida|Illinois|Ohio|Georgia|Michigan|Pennsylvania|Massachusetts|Washington State|Colorado|Arizona|Maryland|Virginia|Oregon|Tennessee|Minnesota|Wisconsin|Indiana|Missouri|New Jersey|Connecticut|North Carolina|South Carolina)\b/i,
  usGeneral: /\b(United States|USA|U\.S\.A|US[- ]based|based in US)\b(?!\s*(?:shift|timing|hours|time zone))/i,
  visa: /\b(H1B|H-1B|H1-B|Green Card|USC|US Citizen|EAD|OPT|CPT|work authorization|work permit|visa sponsor|TN visa|E-?verify)\b/i,
  w2c2c: /\b(W2|W-2|C2C|Corp[- ]to[- ]Corp|1099)\b/i,
  pakistan: /\b(Pakistan|Lahore|Karachi|Islamabad|Rawalpindi|Faisalabad|Multan|Peshawar|Quetta|Sialkot|Gujranwala|Johar Town|Bahria Town|DHA Lahore|DHA Karachi)\b/i,
  middleEast: /\b(Dubai|Abu Dhabi|UAE|Saudi Arabia|Riyadh|Jeddah|Qatar|Doha|Bahrain|Kuwait|Oman|Muscat)\b/i,
  seAsia: /\b(Singapore|Makati|Manila|Philippines|Jakarta|Indonesia|Bangkok|Thailand|Ho Chi Minh|Ha Noi|Hanoi|Vietnam|Kuala Lumpur|Malaysia)\b/i,
  europe: /\b(London|Berlin|Amsterdam|Paris|Munich|Stockholm|Barcelona|Madrid|Dublin|Zurich|Geneva|Vienna|Prague|Warsaw|Lisbon|Rome|Copenhagen|Helsinki|Oslo|Brussels|Edinburgh|Manchester|Hamburg|Frankfurt)\b/i,
  otherCountries: /\b(Canada|Toronto|Vancouver|Montreal|Calgary|Ottawa|Australia|Sydney|Melbourne|Brisbane|Perth|Adelaide|Auckland|New Zealand|Japan|Tokyo|South Korea|Seoul|Taiwan|Taipei|Hong Kong|China|Shanghai|Beijing|Shenzhen)\b/i,
  nonIndiaDomains: /@\S+\.(pk|bd|ae|uk|ca|au|sg|ph|my|sa|qa|de|fr|nl|se|ch|jp|kr|cn|tw|nz)\b/i,
};

const LOCATION_LABELS = {
  usCities: 'US city', usStates: 'US state', usGeneral: 'US-based',
  visa: 'visa/work auth required', w2c2c: 'US contract type',
  pakistan: 'Pakistan-based', middleEast: 'Middle East-based',
  seAsia: 'Southeast Asia-based', europe: 'Europe-based',
  otherCountries: 'non-India country', nonIndiaDomains: 'non-India email domain',
};

const NON_INDIA_KEYS = Object.keys(LOCATION_LABELS);

const INDIA_CITIES = /\b(Bangalore|Bengaluru|Mumbai|Pune|Hyderabad|Chennai|Delhi|Noida|Gurgaon|Gurugram|Kolkata|Ahmedabad|Jaipur|Indore|Chandigarh|Mohali|Kochi|Lucknow|Bhopal|Nagpur|Coimbatore|Surat|Visakhapatnam|Thiruvananthapuram|India)\b/i;

// ============================================================
// 2. OTHER REJECTION PATTERNS
// ============================================================

const F2F_PATTERN = /\b(walk[- ]?in|face[- ]to[- ]face|F2F|in[- ]person interview)\b/i;

const LOCAL_ONLY_PATTERN = /\b(local candidates? only|only local candidates?|locals only|ONLY .{1,30} LOCAL CANDIDATES|local candidates? can apply|must be (based|from|located|residing) in|currently based in .{1,20} only|only (from|candidates? from) .{1,20}(can apply|only|preferred)|only .{1,15} candidates? (can apply|only))\b/i;

const INTERNSHIP_PATTERN = /\b(intern\b|internship|trainee|apprentice|stipend|unpaid)\b/i;

const JOB_SEEKER_PATTERN = /\b(#OpenToWork|open to work|actively looking|actively seeking|seeking opportunities|looking for .{0,15}(job|role|position|opportunity)|job seeker|hire me|currently unemployed)\b/i;

const LOW_SALARY_PATTERN = /\b([1-5]\s*LPA|[1-5]\s*lakhs?\s*(per\s*annum|PA|p\.a\.))\b/i;

const STAFFING_PATTERN = /\b(empanelment|recruitment agency|staffing (company|agency|partner|firm))\b/i;

// ============================================================
// CORE FILTER FUNCTION
// ============================================================

/**
 * Check text for any rejection signal.
 * @param {string} text - Post text to scan
 * @returns {null|{reason: string, category: string}} - null if OK, object if rejected
 */
export function checkLocation(text) {
  if (!text || text.trim().length < 10) return null;

  // ── F2F / walk-in ──
  const f2fMatch = text.match(F2F_PATTERN);
  if (f2fMatch) {
    return { reason: `F2F interview required (${f2fMatch[0]})`, category: 'f2f' };
  }

  // ── Non-India location ──
  const locationHits = [];
  for (const [key, regex] of Object.entries(LOCATION_PATTERNS)) {
    const match = text.match(regex);
    if (match) locationHits.push({ key, matched: match[0] });
  }

  if (locationHits.length > 0) {
    const hasVisa = locationHits.some(h => h.key === 'visa');
    const hasW2 = locationHits.some(h => h.key === 'w2c2c');
    const hasRemote = /\b(remote|work from home|WFH|remote.?friendly|fully remote)\b/i.test(text);
    const hasIndiaRemote = /\b(remote.{0,20}india|india.{0,20}remote|PAN India)\b/i.test(text);
    const hasIndiaLocation = INDIA_CITIES.test(text);

    const nonIndiaHits = locationHits.filter(h => NON_INDIA_KEYS.includes(h.key));

    if (nonIndiaHits.length > 0) {
      // Exceptions
      const skip =
        hasIndiaRemote ||
        (hasRemote && !hasVisa && !hasW2 && nonIndiaHits.length === 1) ||
        (nonIndiaHits.length === 1 && nonIndiaHits[0].key === 'usGeneral' && hasIndiaLocation && !hasVisa && !hasW2);

      if (!skip) {
        const reasons = nonIndiaHits.map(h => `${LOCATION_LABELS[h.key]}: ${h.matched}`);
        return { reason: `Non-India/restricted (${reasons.join(', ')})`, category: 'location' };
      }
    }
  }

  // ── Local candidates only (without specific Indian city context allowing it) ──
  const localMatch = text.match(LOCAL_ONLY_PATTERN);
  if (localMatch) {
    // Exception: "must be based in India" / "Only Indian Candidates" is fine for us
    const localCtx = text.substring(Math.max(0, text.indexOf(localMatch[0]) - 20), text.indexOf(localMatch[0]) + localMatch[0].length + 40);
    const isIndiaContext = /\b(india|indian|pan india|anywhere in india)\b/i.test(localCtx);
    if (!isIndiaContext) {
      return { reason: `Local candidates only (${localMatch[0].substring(0, 50)})`, category: 'local' };
    }
  }

  // ── Internship / stipend / unpaid ──
  const internMatch = text.match(INTERNSHIP_PATTERN);
  if (internMatch) {
    const word = internMatch[0].toLowerCase();
    // Always reject stipend/unpaid
    if (word === 'stipend' || word === 'unpaid') {
      return { reason: `Internship/stipend (${internMatch[0]})`, category: 'intern' };
    }
    // For intern/internship/trainee/apprentice: only reject if the post is primarily about that role
    // Multi-role posts mentioning intern alongside full-time roles should pass through
    const hasFullTime = /\b(full[- ]?time|permanent|regular position)\b/i.test(text);
    if (!hasFullTime) {
      return { reason: `Internship/stipend (${internMatch[0]})`, category: 'intern' };
    }
  }

  // ── Job seekers (not actually hiring) ──
  const seekerMatch = text.match(JOB_SEEKER_PATTERN);
  if (seekerMatch) {
    // Only reject if the post does NOT also contain hiring signals
    const hasHiringSignal = /\b(we are hiring|we're hiring|hiring for|open position|urgent hiring|join our team|looking for a .{0,20}(developer|engineer|designer|candidate)|we are (actively )?(looking|searching|seeking) for|we're (actively )?(looking|searching|seeking) for|we're expanding|we are expanding|our team is (looking|growing|hiring))\b/i.test(text);
    if (!hasHiringSignal) {
      return { reason: `Job seeker, not hiring (${seekerMatch[0].substring(0, 40)})`, category: 'seeker' };
    }
  }

  // ── Low salary (< 6 LPA) ──
  const salaryMatch = text.match(LOW_SALARY_PATTERN);
  if (salaryMatch) {
    return { reason: `Low salary (${salaryMatch[0]})`, category: 'salary' };
  }

  // ── Staffing / recruitment agency ──
  const staffingMatch = text.match(STAFFING_PATTERN);
  if (staffingMatch) {
    return { reason: `Staffing/recruitment (${staffingMatch[0]})`, category: 'staffing' };
  }

  return null;
}

// ============================================================
// CONVENIENCE WRAPPERS
// ============================================================

/**
 * Filter for raw LinkedIn posts (pre-Phase 1, before API call).
 * Post shape: { id, post: { text }, author: { name }, ... }
 * @returns {null|string} - null if OK, rejection reason string if rejected
 */
export function checkRawPost(post) {
  const text = post?.post?.text || '';
  const result = checkLocation(text);
  return result ? result.reason : null;
}

/**
 * Filter for extracted/sheet posts (Phase 2 scoring safety net).
 * Post shape: { postText, summary, job: { location }, contacts: { emails } }
 * @returns {null|string} - null if OK, rejection reason string if rejected
 */
export function checkExtractedPost(extracted) {
  const parts = [
    extracted.postText || '',
    extracted.summary || '',
    extracted.job?.location || '',
    (extracted.contacts?.emails || []).join(' '),
  ];
  const result = checkLocation(parts.join(' '));
  return result ? result.reason : null;
}
