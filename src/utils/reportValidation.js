import {reportCategories} from '../data/reportOptions.js';

export function buildReport(input, reporterId) {
  const title = String(input.title || '').trim();
  const description = String(input.description || '').trim();
  const area = String(input.area || '').trim();
  if (!reporterId || !title || !description || !area) throw new Error('Enter a title, description and location/area.');
  if (title.length > 160 || description.length > 5000 || area.length > 200) throw new Error('One of the incident fields is too long.');
  if (!reportCategories.some(category => category.id === input.category)) throw new Error('Choose a valid category.');
  const {latitude, longitude, accuracy} = input;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error('Attach valid GPS coordinates using your current location.');
  }
  // Auth identity is derived again by the RPC. No browser-owned priority/status/assignment.
  return {
    incident_title:title, incident_description:description, incident_category:input.category,
    incident_area:area, gps_latitude:latitude, gps_longitude:longitude, gps_accuracy:accuracy,
  };
}
