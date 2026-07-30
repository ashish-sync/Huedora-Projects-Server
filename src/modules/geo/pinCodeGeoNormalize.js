/**
 * PIN geography normalization — official GoI / India Post names aligned to bundled geo seed.
 * Used by PIN import and the cleanPinCodeMaster script.
 */

import { canonicalStateName, resolveZoneNameForState } from './geo.zones.js';
import {
  DISTRICT_SUPPLEMENTS_BY_STATE,
  buildDistrictAliasMap,
  buildDistrictCityFallbackMap,
  normGeoKey,
} from './geo.districtSupplements.js';

export { normGeoKey };

const ZONE_ALIASES = {
  north: 'North Zone',
  south: 'South Zone',
  east: 'East Zone',
  west: 'West Zone',
  central: 'Central Zone',
  'north-east': 'North-East Zone',
  northeast: 'North-East Zone',
};

/** stateNorm|districtNorm → seed district name (must exist in seed or supplements) */
export const PIN_DISTRICT_ALIASES = {
  'andhra pradesh|y.s.r.': 'YSR Kadapa',
  'andhra pradesh|y.s.r': 'YSR Kadapa',
  'andhra pradesh|spsr nellore': 'Nellore',
  'andhra pradesh|visakhapatanam': 'Visakhapatnam',
  'andhra pradesh|visakhapatnam': 'Visakhapatnam',
  'andhra pradesh|eluru': 'West Godavari',
  'andhra pradesh|konaseema': 'East Godavari',
  'andhra pradesh|bapatla': 'Guntur',
  'andhra pradesh|nandyal': 'Kurnool',
  'andhra pradesh|sri sathya sai': 'Anantapur',
  'andhra pradesh|tirupati': 'Chittoor',
  'andhra pradesh|palnadu': 'Guntur',
  'andhra pradesh|ntr': 'Krishna',
  'andhra pradesh|anakapalli': 'Visakhapatnam',
  'andhra pradesh|parvathipuram manyam': 'Vizianagaram',
  'andhra pradesh|annamayya': 'YSR Kadapa',
  'andhra pradesh|alluri sitharama raju': 'East Godavari',
  'andhra pradesh|kakinada': 'East Godavari',
  'assam|kamrup metro': 'Kamrup Metropolitan',
  'assam|marigaon': 'Morigaon',
  'assam|bajali': 'Barpeta',
  'assam|south salmara mancachar': 'Dhubri',
  'bihar|purbi champaran': 'East Champaran',
  'bihar|pashchim champaran': 'West Champaran',
  'bihar|purnia': 'Purnea',
  'bihar|munger': 'Monghyr',
  'chandigarh|chandigarh': 'Chandigarh',
  'chhattisgarh|korea': 'Korea (Koriya)',
  'chhattisgarh|kanker': 'Kanker (North Bastar)',
  'chhattisgarh|dantewada': 'Dantewada (South Bastar)',
  'chhattisgarh|kabirdham': 'Kabirdham (Kawardha)',
  'chhattisgarh|gaurella pendra marwahi': 'Bilaspur',
  'delhi|new delhi': 'New Delhi',
  'delhi|central': 'Central Delhi',
  'delhi|north': 'North Delhi',
  'delhi|south': 'South Delhi',
  'delhi|east': 'East Delhi',
  'delhi|west': 'West Delhi',
  'delhi|north west': 'North West Delhi',
  'delhi|north east': 'North East Delhi',
  'delhi|south west': 'South West Delhi',
  'delhi|south east': 'South East Delhi',
  'delhi|shahdara': 'Shahdara',
  'gujarat|ahmadabad': 'Ahmedabad',
  'gujarat|mahesana': 'Mehsana',
  'gujarat|banas kantha': 'Banaskantha (Palanpur)',
  'gujarat|sabar kantha': 'Sabarkantha (Himmatnagar)',
  'gujarat|kheda': 'Kheda (Nadiad)',
  'gujarat|arvalli': 'Aravalli',
  'gujarat|panch mahals': 'Panchmahal (Godhra)',
  'gujarat|dohad': 'Dahod',
  'gujarat|tapi': 'Tapi (Vyara)',
  'gujarat|chhotaudepur': 'Chhota Udepur',
  'gujarat|devbhumi dwarka': 'Devbhoomi Dwarka',
  'gujarat|dang': 'Dangs (Ahwa)',
  'gujarat|narmada': 'Narmada (Rajpipla)',
  'haryana|gurugram': 'Gurgaon',
  'haryana|charki dadri': 'Charkhi Dadri',
  'haryana|nuh': 'Mewat',
  'himachal pradesh|sirmaur': 'Sirmour',
  'himachal pradesh|lahul and spiti': 'Lahaul & Spiti',
  'jammu and kashmir|bandipora': 'Bandipore',
  'jharkhand|east singhbum': 'East Singhbhum',
  'jharkhand|hazaribagh': 'Hazaribag',
  'jharkhand|saraikela kharsawan': 'Seraikela-Kharsawan',
  'jharkhand|sahebganj': 'Sahibganj',
  'karnataka|belagavi': 'Belagavi (Belgaum)',
  'karnataka|bengaluru urban': 'Bengaluru (Bangalore) Urban',
  'karnataka|bengaluru rural': 'Bengaluru (Bangalore) Rural',
  'karnataka|uttara kannada': 'Uttara Kannada (Karwar)',
  'karnataka|mysuru': 'Mysuru (Mysore)',
  'karnataka|tumakuru': 'Tumakuru (Tumkur)',
  'karnataka|shivamogga': 'Shivamogga (Shimoga)',
  'karnataka|chikkamagaluru': 'Chikkamagaluru (Chikmagalur)',
  'karnataka|vijayapura': 'Vijayapura (Bijapur)',
  'karnataka|kalaburagi': 'Kalaburagi (Gulbarga)',
  'karnataka|ballari': 'Ballari (Bellary)',
  'karnataka|chamarajanagara': 'Chamarajanagar',
  'karnataka|chikkaballapura': 'Chikballapur',
  'karnataka|vijaynagar': 'Ballari (Bellary)',
  'madhya pradesh|east nimar': 'Khandwa',
  'madhya pradesh|niwari': 'Tikamgarh',
  'maharashtra|mumbai': 'Mumbai City',
  'odisha|baleshwar': 'Balasore',
  'odisha|jajapur': 'Jajpur',
  'odisha|kendujhar': 'Kendujhar (Keonjhar)',
  'odisha|anugul': 'Angul',
  'punjab|shahid bhagat singh nagar': 'Nawanshahr',
  'punjab|s.a.s nagar': 'Mohali',
  'punjab|firozepur': 'Ferozepur',
  'punjab|sri muktsar sahib': 'Muktsar',
  'punjab|malerkotla': 'Sangrur',
  'puducherry|pondicherry': 'Puducherry',
  'puducherry|karaikal': 'Karaikal',
  'puducherry|mahe': 'Mahe',
  'rajasthan|ganganagar': 'Sri Ganganagar',
  'tamil nadu|tuticorin': 'Thoothukudi (Tuticorin)',
  'tamil nadu|kanniyakumari': 'Kanyakumari',
  'tamil nadu|thiruvarur': 'Tiruvarur',
  'tamil nadu|thiruvallur': 'Tiruvallur',
  'tamil nadu|villupuram': 'Viluppuram',
  'tamil nadu|the nilgiris': 'Nilgiris',
  'tamil nadu|chengalpattu': 'Kanchipuram',
  'tamil nadu|mayiladuthurai': 'Nagapattinam',
  'tamil nadu|tenkasi': 'Tirunelveli',
  'tamil nadu|ranipet': 'Vellore',
  'tamil nadu|kallakurichi': 'Viluppuram',
  'tamil nadu|tirupathur': 'Vellore',
  'telangana|ranga reddy': 'Rangareddy',
  'telangana|medchal malkajgiri': 'Medchal',
  'telangana|hanumakonda': 'Warangal (Urban)',
  'telangana|jagitial': 'Jagtial',
  'telangana|jangoan': 'Warangal (Rural)',
  'telangana|warangal': 'Warangal (Urban)',
  'telangana|kumuram bheem asifabad': 'Komaram Bheem Asifabad',
  'telangana|mulugu': 'Warangal (Rural)',
  'telangana|narayanpet': 'Mahabubnagar',
  'telangana|jayashankar bhupalapally': 'Warangal (Rural)',
  'uttar pradesh|prayagraj': 'Allahabad',
  'uttar pradesh|ayodhya': 'Faizabad',
  'uttar pradesh|rae bareli': 'RaeBareli',
  'uttar pradesh|kushi nagar': 'Kushinagar (Padrauna)',
  'uttar pradesh|amethi': 'Amethi (Chatrapati Sahuji Mahraj Nagar)',
  'uttar pradesh|kheri': 'Lakhimpur - Kheri',
  'uttar pradesh|amroha': 'Amroha (J.P. Nagar)',
  'uttar pradesh|kasganj': 'Kanshiram Nagar (Kasganj)',
  'uttar pradesh|shamli': 'Muzaffarnagar',
  'uttar pradesh|hapur': 'Hapur (Panchsheel Nagar)',
  'uttar pradesh|sambhal': 'Sambhal (Bhim Nagar)',
  'uttar pradesh|sant kabeer nagar': 'Sant Kabir Nagar',
  'uttarakhand|udam singh nagar': 'Udham Singh Nagar',
  'uttarakhand|rudra prayag': 'Rudraprayag',
  'uttarakhand|uttar kashi': 'Uttarkashi',
  'west bengal|24 paraganas north': 'North 24 Parganas',
  'west bengal|24 paraganas south': 'South 24 Parganas',
  'west bengal|medinipur east': 'Purba Medinipur (East Medinipur)',
  'west bengal|medinipur west': 'Paschim Medinipur (West Medinipur)',
  'west bengal|paschim bardhaman': 'Burdwan (Bardhaman)',
  'west bengal|purba bardhaman': 'Burdwan (Bardhaman)',
  'west bengal|maldah': 'Malda',
  'west bengal|coochbehar': 'Cooch Behar',
  'west bengal|dinajpur dakshin': 'Dakshin Dinajpur (South Dinajpur)',
  'west bengal|dinajpur uttar': 'Uttar Dinajpur (North Dinajpur)',
  'west bengal|jhargram': 'Paschim Medinipur (West Medinipur)',
};

/** Official display district name (India Post / GoI) after correction */
export const PIN_DISTRICT_OFFICIAL_NAMES = {
  'andhra pradesh|y.s.r.': 'YSR Kadapa',
  'andhra pradesh|y.s.r': 'YSR Kadapa',
  'andhra pradesh|spsr nellore': 'Sri Potti Sriramulu Nellore',
  'andhra pradesh|visakhapatanam': 'Visakhapatnam',
  'gujarat|ahmadabad': 'Ahmedabad',
  'karnataka|belagavi': 'Belagavi',
  'karnataka|bengaluru urban': 'Bengaluru Urban',
  'karnataka|bengaluru rural': 'Bengaluru Rural',
  'karnataka|mysuru': 'Mysuru',
  'karnataka|tumakuru': 'Tumakuru',
  'karnataka|shivamogga': 'Shivamogga',
  'karnataka|chikkamagaluru': 'Chikkamagaluru',
  'karnataka|vijayapura': 'Vijayapura',
  'karnataka|kalaburagi': 'Kalaburagi',
  'karnataka|ballari': 'Ballari',
  'karnataka|chamarajanagara': 'Chamarajanagar',
  'karnataka|chikkaballapura': 'Chikkaballapur',
  'karnataka|vijaynagar': 'Vijayanagara',
  'karnataka|uttara kannada': 'Uttara Kannada',
  'tamil nadu|tuticorin': 'Thoothukudi',
  'tamil nadu|kanniyakumari': 'Kanniyakumari',
  'tamil nadu|thiruvarur': 'Thiruvarur',
  'tamil nadu|thiruvallur': 'Thiruvallur',
  'tamil nadu|villupuram': 'Viluppuram',
  'tamil nadu|the nilgiris': 'The Nilgiris',
  'tamil nadu|chengalpattu': 'Chengalpattu',
  'tamil nadu|mayiladuthurai': 'Mayiladuthurai',
  'tamil nadu|tenkasi': 'Tenkasi',
  'tamil nadu|ranipet': 'Ranipet',
  'tamil nadu|kallakurichi': 'Kallakurichi',
  'tamil nadu|tirupathur': 'Tirupattur',
  'uttar pradesh|prayagraj': 'Prayagraj',
  'uttar pradesh|ayodhya': 'Ayodhya',
  'uttar pradesh|rae bareli': 'Rae Bareli',
  'uttar pradesh|kushi nagar': 'Kushinagar',
  'haryana|gurugram': 'Gurugram',
  'maharashtra|mumbai': 'Mumbai',
  'odisha|baleshwar': 'Balasore',
  'odisha|jajapur': 'Jajpur',
  'odisha|kendujhar': 'Kendujhar',
  'odisha|anugul': 'Anugul',
  'west bengal|24 paraganas north': 'North 24 Parganas',
  'west bengal|24 paraganas south': 'South 24 Parganas',
  'west bengal|medinipur east': 'Purba Medinipur',
  'west bengal|medinipur west': 'Paschim Medinipur',
  'west bengal|paschim bardhaman': 'Paschim Bardhaman',
  'west bengal|purba bardhaman': 'Purba Bardhaman',
  'west bengal|maldah': 'Malda',
  'west bengal|coochbehar': 'Cooch Behar',
  'west bengal|dinajpur dakshin': 'Dakshin Dinajpur',
  'west bengal|dinajpur uttar': 'Uttar Dinajpur',
  'west bengal|jhargram': 'Jhargram',
  'puducherry|pondicherry': 'Puducherry',
  'punjab|s.a.s nagar': 'S.A.S. Nagar',
  'punjab|shahid bhagat singh nagar': 'Shahid Bhagat Singh Nagar',
  'punjab|sri muktsar sahib': 'Sri Muktsar Sahib',
  'jharkhand|east singhbum': 'East Singhbhum',
  'jharkhand|hazaribagh': 'Hazaribagh',
  'jharkhand|sahebganj': 'Sahebganj',
  'jharkhand|saraikela kharsawan': 'Saraikela Kharsawan',
  'bihar|purbi champaran': 'Purbi Champaran',
  'bihar|pashchim champaran': 'Pashchimi Champaran',
  'bihar|purnia': 'Purnia',
  'bihar|munger': 'Munger',
  'gujarat|mahesana': 'Mahesana',
  'gujarat|banas kantha': 'Banas Kantha',
  'gujarat|sabar kantha': 'Sabar Kantha',
  'gujarat|panch mahals': 'Panch Mahals',
  'gujarat|devbhumi dwarka': 'Devbhumi Dwarka',
  'gujarat|chhotaudepur': 'Chhotaudepur',
  'gujarat|dohad': 'Dahod',
  'gujarat|dang': 'Dang',
  'gujarat|arvalli': 'Aravalli',
  'himachal pradesh|sirmaur': 'Sirmaur',
  'himachal pradesh|lahul and spiti': 'Lahaul & Spiti',
  'uttarakhand|udam singh nagar': 'Udham Singh Nagar',
  'uttarakhand|rudra prayag': 'Rudraprayag',
  'uttarakhand|uttar kashi': 'Uttarkashi',
  'assam|kamrup metro': 'Kamrup Metropolitan',
  'assam|marigaon': 'Marigaon',
  'rajasthan|ganganagar': 'Sri Ganganagar',
  'delhi|new delhi': 'New Delhi',
  'delhi|central': 'Central Delhi',
  'delhi|north': 'North Delhi',
  'delhi|south': 'South Delhi',
  'delhi|east': 'East Delhi',
  'delhi|west': 'West Delhi',
  'delhi|north west': 'North West Delhi',
  'delhi|north east': 'North East Delhi',
  'delhi|south west': 'South West Delhi',
  'delhi|south east': 'South East Delhi',
  'delhi|shahdara': 'Shahdara',
};

/** Official city for districts where geo seed city is not ideal */
export const PIN_CITY_OVERRIDES = {
  'delhi|new delhi': 'New Delhi',
  'delhi|central': 'New Delhi',
  'delhi|central delhi': 'New Delhi',
  'chandigarh|chandigarh': 'Chandigarh',
  'puducherry|pondicherry': 'Puducherry',
  'puducherry|puducherry': 'Puducherry',
  'maharashtra|mumbai': 'Mumbai',
  'tamil nadu|chengalpattu': 'Chengalpattu',
  'tamil nadu|mayiladuthurai': 'Mayiladuthurai',
  'tamil nadu|tenkasi': 'Tenkasi',
  'tamil nadu|ranipet': 'Ranipet',
  'tamil nadu|kallakurichi': 'Kallakurichi',
  'tamil nadu|tirupathur': 'Tirupattur',
  'tamil nadu|tirupattur': 'Tirupattur',
  'andhra pradesh|tirupati': 'Tirupati',
  'andhra pradesh|eluru': 'Eluru',
  'andhra pradesh|konaseema': 'Kakinada',
  'andhra pradesh|kakinada': 'Kakinada',
  'andhra pradesh|ntr': 'Vijayawada',
  'andhra pradesh|bapatla': 'Bapatla',
  'andhra pradesh|nandyal': 'Nandyal',
  'andhra pradesh|sri sathya sai': 'Puttaparthi',
  'andhra pradesh|palnadu': 'Narasaraopet',
  'andhra pradesh|anakapalli': 'Anakapalli',
  'andhra pradesh|annamayya': 'Rayachoti',
  'andhra pradesh|alluri sitharama raju': 'Paderu',
  'andhra pradesh|parvathipuram manyam': 'Parvathipuram',
  'karnataka|vijaynagar': 'Hosapete',
  'west bengal|jhargram': 'Jhargram',
  'west bengal|paschim bardhaman': 'Asansol',
  'west bengal|purba bardhaman': 'Bardhaman',
  'uttar pradesh|prayagraj': 'Prayagraj',
  'uttar pradesh|ayodhya': 'Ayodhya',
  'haryana|gurugram': 'Gurugram',
};

export function primaryGeoName(name = '') {
  return String(name || '')
    .replace(/&amp;/g, '&')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
}

export function alternateGeoName(name = '') {
  const match = String(name || '').match(/\(([^)]+)\)/);
  return match ? match[1].trim() : '';
}

export function titleCaseWords(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((word) => word
      .split('-')
      .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
      .join('-'))
    .join(' ');
}

export function normalizeZoneName(zoneInput = '', stateName = '') {
  const raw = String(zoneInput || '').trim();
  if (!raw) return resolveZoneNameForState(stateName);
  const key = normGeoKey(raw).replace(/\s+zone$/, '');
  return ZONE_ALIASES[key] || (raw.endsWith('Zone') ? raw : resolveZoneNameForState(stateName) || raw);
}

export function normalizeStateName(stateInput = '') {
  return canonicalStateName(String(stateInput || '').trim());
}

export function buildGeoResolverIndexes(geoSeed) {
  const states = geoSeed.states || [];
  const districts = [...(geoSeed.districts || [])];
  const cities = geoSeed.cities || [];

  const stateByName = new Map();
  for (const state of states) {
    stateByName.set(normGeoKey(state.name), state);
  }

  const districtAliasesByState = new Map();
  const districtCityFallbacksByState = new Map();
  for (const [stateKey, supplements] of Object.entries(DISTRICT_SUPPLEMENTS_BY_STATE)) {
    districtAliasesByState.set(stateKey, buildDistrictAliasMap(supplements));
    districtCityFallbacksByState.set(stateKey, buildDistrictCityFallbackMap(supplements));
    const state = states.find((row) => normGeoKey(row.name) === stateKey);
    if (!state) continue;
    for (const entry of supplements) {
      districts.push({
        _id: `${state._id}_supp_${normGeoKey(entry.name).replace(/\s+/g, '_')}`,
        stateId: state._id,
        name: entry.name,
        isSupplement: true,
      });
    }
  }

  const districtByKey = new Map();
  for (const district of districts) {
    const decodedName = String(district.name || '').replace(/&amp;/g, '&');
    districtByKey.set(`${district.stateId}|${normGeoKey(decodedName)}`, district);
    districtByKey.set(`${district.stateId}|${normGeoKey(district.name)}`, district);
    const primary = normGeoKey(primaryGeoName(decodedName));
    if (primary !== normGeoKey(decodedName)) {
      districtByKey.set(`${district.stateId}|${primary}`, district);
    }
    const alt = alternateGeoName(decodedName);
    if (alt) {
      districtByKey.set(`${district.stateId}|${normGeoKey(alt)}`, district);
    }
  }

  const citiesByDistrict = new Map();
  const citiesByState = new Map();
  const cityByStateAndName = new Map();
  for (const city of cities) {
    const districtKey = String(city.districtId || '');
    if (districtKey) {
      const list = citiesByDistrict.get(districtKey) || [];
      list.push(city);
      citiesByDistrict.set(districtKey, list);
    }
    const stateKey = String(city.stateId || '');
    const stateList = citiesByState.get(stateKey) || [];
    stateList.push(city);
    citiesByState.set(stateKey, stateList);
    cityByStateAndName.set(`${stateKey}|${normGeoKey(city.name)}`, city);
    const cityPrimary = normGeoKey(primaryGeoName(city.name));
    if (cityPrimary !== normGeoKey(city.name)) {
      cityByStateAndName.set(`${stateKey}|${cityPrimary}`, city);
    }
  }

  return {
    states,
    districts,
    cities,
    stateByName,
    districtByKey,
    citiesByDistrict,
    citiesByState,
    cityByStateAndName,
    districtAliasesByState,
    districtCityFallbacksByState,
  };
}

function resolveSeedDistrictName(state, districtInput, indexes) {
  const stateNorm = normGeoKey(state.name);
  const rawKey = normGeoKey(districtInput);
  const aliasKey = `${stateNorm}|${rawKey}`;
  const aliasTarget = PIN_DISTRICT_ALIASES[aliasKey];
  if (aliasTarget) return aliasTarget;

  const supplements = indexes.districtAliasesByState.get(stateNorm);
  const canonicalFromSupplement = supplements?.get(rawKey);
  if (canonicalFromSupplement) return canonicalFromSupplement;

  const direct = indexes.districtByKey.get(`${state._id}|${rawKey}`);
  if (direct) return direct.name;

  const inState = indexes.districts.filter((row) => row.stateId === state._id);
  for (const district of inState) {
    const primary = normGeoKey(primaryGeoName(district.name));
    const alt = normGeoKey(alternateGeoName(district.name));
    if (primary === rawKey || alt === rawKey) return district.name;
  }

  if (stateNorm === 'delhi') {
    const delhiAlias = indexes.districtByKey.get(`${state._id}|${normGeoKey(`${districtInput} Delhi`)}`);
    if (delhiAlias) return delhiAlias.name;
  }

  return null;
}

function resolveCityForDistrict({ district, state, districtInput = '' }, indexes) {
  const districtId = String(district._id);
  const districtNorm = normGeoKey(primaryGeoName(district.name));
  const inputNorm = normGeoKey(districtInput || primaryGeoName(district.name));
  const inDistrict = indexes.citiesByDistrict.get(districtId) || [];

  const districtCity = inDistrict.find((city) => normGeoKey(primaryGeoName(city.name)) === districtNorm);
  if (districtCity) return districtCity;

  if (inDistrict.length) return inDistrict[0];

  const stateKey = String(state._id);
  const stateNorm = normGeoKey(state.name);
  const cityFallbacks = indexes.districtCityFallbacksByState.get(stateNorm);
  const fallbackCityName = cityFallbacks?.get(inputNorm) || cityFallbacks?.get(districtNorm);
  if (fallbackCityName) {
    const fallbackCity = indexes.cityByStateAndName.get(
      `${stateKey}|${normGeoKey(fallbackCityName)}`
    );
    if (fallbackCity) return fallbackCity;
  }

  const stateCity = indexes.cityByStateAndName.get(`${stateKey}|${districtNorm}`);
  if (stateCity) return stateCity;

  if (stateNorm === 'delhi') {
    const delhiCity = indexes.cityByStateAndName.get(`${stateKey}|${normGeoKey(`${districtInput} Delhi`)}`);
    if (delhiCity) return delhiCity;
  }

  const inState = indexes.citiesByState.get(stateKey) || [];
  if (inState.length) return inState[0];
  return null;
}

export function officialDistrictName(stateName, districtInput, seedDistrictName = '') {
  const key = `${normGeoKey(stateName)}|${normGeoKey(districtInput)}`;
  if (PIN_DISTRICT_OFFICIAL_NAMES[key]) return PIN_DISTRICT_OFFICIAL_NAMES[key];
  if (seedDistrictName) return primaryGeoName(seedDistrictName);
  return titleCaseWords(primaryGeoName(districtInput));
}

export function officialCityName(stateName, districtInput, cityRecord = null) {
  const key = `${normGeoKey(stateName)}|${normGeoKey(districtInput)}`;
  if (PIN_CITY_OVERRIDES[key]) return PIN_CITY_OVERRIDES[key];
  if (cityRecord?.name) return primaryGeoName(cityRecord.name);
  return officialDistrictName(stateName, districtInput);
}

export function normalizePinGeoRow(
  { pinCode, stateName, districtName, zoneName = '', cityName = '' },
  indexes,
) {
  const normalizedPin = String(pinCode || '').replace(/\D+/g, '').padStart(6, '0').slice(-6);
  const state = indexes.stateByName.get(normGeoKey(normalizeStateName(stateName)));
  if (!state) {
    return { ok: false, error: `State not found: ${stateName}` };
  }

  const canonicalState = state.name;
  const seedDistrictName = resolveSeedDistrictName(state, districtName, indexes);
  if (!seedDistrictName) {
    return { ok: false, error: `District not found: ${districtName}` };
  }

  const district = indexes.districtByKey.get(`${state._id}|${normGeoKey(seedDistrictName)}`)
    || indexes.districts.find((row) => row.stateId === state._id && row.name === seedDistrictName);
  if (!district) {
    return { ok: false, error: `District not found: ${districtName}` };
  }

  let city = null;
  if (cityName) {
    city = indexes.cityByStateAndName.get(`${state._id}|${normGeoKey(cityName)}`);
    if (!city) {
      return { ok: false, error: `City not found: ${cityName}` };
    }
  } else {
    city = resolveCityForDistrict({ district, state, districtInput: districtName }, indexes);
  }

  const officialDistrict = officialDistrictName(canonicalState, districtName, seedDistrictName);
  const officialCity = officialCityName(canonicalState, officialDistrict, city);
  const zone = normalizeZoneName(zoneName, canonicalState);

  return {
    ok: true,
    pinCode: normalizedPin,
    state: canonicalState,
    zone,
    district: officialDistrict,
    city: officialCity,
    seedDistrict: seedDistrictName,
    seedCity: city?.name || '',
    changed: {
      state: normGeoKey(stateName) !== normGeoKey(canonicalState),
      zone: normGeoKey(zoneName) !== normGeoKey(zone),
      district: normGeoKey(districtName) !== normGeoKey(officialDistrict),
      city: cityName ? normGeoKey(cityName) !== normGeoKey(officialCity) : false,
    },
  };
}

export function resolveDistrictAlias(stateName, districtName) {
  const stateNorm = normGeoKey(normalizeStateName(stateName));
  const districtNorm = normGeoKey(districtName);
  return PIN_DISTRICT_ALIASES[`${stateNorm}|${districtNorm}`] || districtName;
}
