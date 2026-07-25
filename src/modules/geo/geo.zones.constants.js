/** Default India camp zones and state / UT assignments (matches geo_states seed names). */
export const CAMP_ZONE_DEFINITIONS = [
  {
    code: 'north',
    name: 'North Zone',
    sortOrder: 1,
    states: [
      'Chandigarh',
      'Delhi',
      'Haryana',
      'Himachal Pradesh',
      'Jammu and Kashmir',
      'Ladakh',
      'Punjab',
      'Rajasthan',
      'Uttarakhand',
    ],
  },
  {
    code: 'south',
    name: 'South Zone',
    sortOrder: 2,
    states: [
      'Andhra Pradesh',
      'Karnataka',
      'Kerala',
      'Tamil Nadu',
      'Telangana',
      'Puducherry',
      'Lakshadweep',
    ],
  },
  {
    code: 'east',
    name: 'East Zone',
    sortOrder: 3,
    states: ['Bihar', 'Jharkhand', 'Odisha', 'West Bengal'],
  },
  {
    code: 'west',
    name: 'West Zone',
    sortOrder: 4,
    states: ['Goa', 'Gujarat', 'Maharashtra', 'Dadra and Nagar Haveli and Daman and Diu'],
  },
  {
    code: 'central',
    name: 'Central Zone',
    sortOrder: 5,
    states: ['Chhattisgarh', 'Madhya Pradesh', 'Uttar Pradesh'],
  },
  {
    code: 'north-east',
    name: 'North-East Zone',
    sortOrder: 6,
    states: [
      'Arunachal Pradesh',
      'Assam',
      'Manipur',
      'Meghalaya',
      'Mizoram',
      'Nagaland',
      'Sikkim',
      'Tripura',
    ],
  },
];

/** Common display / import aliases → canonical geo state name. */
export const STATE_NAME_ALIASES = {
  'delhi (nct)': 'Delhi',
  'nct of delhi': 'Delhi',
  'jammu & kashmir': 'Jammu and Kashmir',
  'jammu and kashmir': 'Jammu and Kashmir',
  'dadra & nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'dadra and nagar haveli and daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'uttaranchal': 'Uttarakhand',
};
