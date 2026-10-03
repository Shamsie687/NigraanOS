export const reportCategories = [
  ['traffic', 'Traffic'], ['flood', 'Flood'], ['garbage', 'Garbage'],
  ['air_quality', 'Air quality'], ['water', 'Water'], ['power', 'Electricity'],
  ['road_damage', 'Road damage'], ['other', 'Other'],
].map(([id, label]) => ({ id, label }));
export const organizationTypes = [
  ['government', 'Government'], ['ngo', 'NGO'], ['civic_organization', 'Civic organization'],
  ['utility', 'Utility'], ['volunteer_group', 'Volunteer group'], ['other', 'Other'],
];
export function displayStatus(value) {
  return (value || '').replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
}
