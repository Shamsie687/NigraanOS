import {reportCategories} from '../data/reportOptions.js';
export const citizenAction=status=>status==='reported'?'Edit Report':['acknowledged','assigned','in_progress'].includes(status)?'Add Update':'View Details';
export function citizenFields(input) {
  const result={title:String(input.title||'').trim(),description:String(input.description||'').trim(),category:input.category,area:String(input.area||'').trim(),latitude:input.latitude,longitude:input.longitude,location_accuracy:input.location_accuracy??null};
  if(!result.title||result.title.length>160||!result.description||result.description.length>5000||!result.area||result.area.length>200||!reportCategories.some(category=>category.id===result.category))throw new Error('Enter a valid title, description, category and area.');
  if(!Number.isFinite(result.latitude)||result.latitude < -90||result.latitude>90||!Number.isFinite(result.longitude)||result.longitude < -180||result.longitude>180||result.location_accuracy!==null&&(!Number.isFinite(result.location_accuracy)||result.location_accuracy<0))throw new Error('Attach valid GPS coordinates.');
  return result;
}
