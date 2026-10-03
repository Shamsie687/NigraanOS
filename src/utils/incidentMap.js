export const categoryStyles = {
  traffic:{symbol:'↔',color:'#ffb45b'},flood:{symbol:'≈',color:'#65b7ff'},
  garbage:{symbol:'▤',color:'#a6cf83'},air_quality:{symbol:'◌',color:'#e5dc95'},
  water:{symbol:'◇',color:'#63d4d1'},power:{symbol:'ϟ',color:'#c4a2ff'},
  road_damage:{symbol:'≋',color:'#ed9cbb'},other:{symbol:'+',color:'#a5b5c9'},
};
export function hasValidCoordinates(incident) {
  const {latitude,longitude}=incident || {};
  return typeof latitude==='number' && Number.isFinite(latitude) && latitude>=-90 && latitude<=90 &&
    typeof longitude==='number' && Number.isFinite(longitude) && longitude>=-180 && longitude<=180;
}
export function filterMapIncidents(incidents,{category='all',status='all'}={}) {
  return incidents.filter(incident=>hasValidCoordinates(incident) &&
    (category==='all'||incident.category===category) && (status==='all'||incident.status===status));
}
export function markerPresentation(incident) {
  const category=Object.hasOwn(categoryStyles,incident.category)?incident.category:'other';
  const priority=String(incident.priority || '').toLowerCase();
  const urgency=priority==='critical'?'critical':priority==='high'?'high':'standard';
  return {category,...categoryStyles[category],urgency,resolved:incident.status==='resolved'};
}
const priorityOrder={critical:5,high:4,medium:3,normal:2,low:1};
export function prioritizeIncidents(incidents,limit=6) {
  return incidents.filter(incident=>incident.status!=='resolved').slice().sort((a,b)=>{
    const priority=(priorityOrder[String(b.priority).toLowerCase()]||0)-(priorityOrder[String(a.priority).toLowerCase()]||0);
    return priority || (Date.parse(b.reported_at)||0)-(Date.parse(a.reported_at)||0) || a.id.localeCompare(b.id);
  }).slice(0,limit);
}
