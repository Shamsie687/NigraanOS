export {city} from '../config/city.js';
export const categories = [['flood', 'Flood', '≈', '#65b7ff'], ['traffic', 'Traffic', '↔', '#ffb45b'], ['garbage', 'Garbage', '▤', '#a6cf83'], ['water', 'Water', '◇', '#63d4d1'], ['power', 'Power', 'ϟ', '#c4a2ff'], ['road_damage', 'Road Damage', '≋', '#ed9cbb'], ['air_quality', 'Air Quality', '◌', '#e5dc95'], ['other', 'Other', '+', '#a5b5c9']].map(([id, label, symbol, color]) => ({
  id,
  label,
  symbol,
  color
}));
export const alerts = [{
  title: 'Water supply disruption',
  detail: 'Demo advisory: selected areas of Korangi may experience low pressure.',
  severity: 'Service update'
}];
export const navigation = [['Dashboard', '◫', null], ['Live Map', '◎', null], ['Traffic', '↔', 'traffic'], ['Flood Risk', '≈', 'flood'], ['Garbage', '▤', 'garbage'], ['Air Quality', '◌', 'air_quality'], ['Water', '◇', 'water'], ['Power', 'ϟ', 'power'], ['Road Conditions', '≋', 'road_damage'], ['Citizen Reports', '▧', 'citizen'], ['Analytics', '▥', null]];

