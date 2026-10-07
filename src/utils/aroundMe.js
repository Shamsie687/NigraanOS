import {coverage,gridRows,gridColumns} from '../config/aroundMe.js';
export {coverage};
export const publicWorkflowLabels={reported:'Reported in NigraanOS',acknowledged:'Acknowledged in NigraanOS',processing:'In Operations workflow',resolved:'Marked resolved in NigraanOS'};
export const privacyCopy='To protect Citizens, NigraanOS only shows generalized groups when enough distinct reporters contribute.';
export const statusCopy='Recorded status does not confirm verification, dispatch, attendance or physical resolution.';
export function generalizeLocation(latitude,longitude){
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<coverage.south||latitude>=coverage.north||longitude<coverage.west||longitude>=coverage.east)throw new Error('Location is outside Around Me coverage. You can use the default area.');
  // Match SQL decimal grid arithmetic at exact edges.
  const cell=(n,start)=>Math.floor((Math.round(n*1e9)-Math.round(start*1e9))/Math.round(coverage.step*1e9));
  return {row:Math.min(gridRows-1,cell(latitude,coverage.south)),column:Math.min(gridColumns-1,cell(longitude,coverage.west))};
}
export function cellCenter({row,column}){return [coverage.south+(row+0.5)*coverage.step,coverage.west+(column+0.5)*coverage.step];}
export function filterAroundMe(cells,category='all',state='all'){
  return cells.map(cell=>({...cell,groups:cell.groups.filter(group=>(category==='all'||group.category===category)&&(state==='all'||group.publicWorkflowState===state))})).filter(cell=>cell.groups.length);
}
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
export function validateAroundMe(data,query){
  if(!keys(data,['snapshotDay','reportingWindowDays','cells'])||!/^\d{4}-\d{2}-\d{2}$/.test(data.snapshotDay)||data.reportingWindowDays!==30||!Array.isArray(data.cells)||data.cells.length>9)throw new Error('Around Me data is unavailable.');
  const seen=new Set(),categories=['traffic','flood','garbage','air_quality','water','power','road_damage','other'];
  for(const cell of data.cells){
    if(!keys(cell,['cellId','generalizedBounds','generalizedCenter','groups']))throw new Error('Around Me data is unavailable.');
    const match=/^K-(\d+)-(\d+)$/.exec(cell.cellId),row=Number(match?.[1]),column=Number(match?.[2]);
    if(!match||seen.has(cell.cellId)||row>=gridRows||column>=gridColumns||Math.abs(row-query.row)>1||Math.abs(column-query.column)>1)throw new Error('Around Me data is unavailable.');seen.add(cell.cellId);
    const expected=[[coverage.south+row*coverage.step,coverage.west+column*coverage.step],[coverage.south+(row+1)*coverage.step,coverage.west+(column+1)*coverage.step]],center=cellCenter({row,column});
    const point=(p,e)=>Array.isArray(p)&&p.length===2&&p.every((n,i)=>Number.isFinite(n)&&Math.abs(n-e[i])<1e-8);
    if(!point(cell.generalizedCenter,center)||!Array.isArray(cell.generalizedBounds)||cell.generalizedBounds.length!==2||!cell.generalizedBounds.every((p,i)=>point(p,expected[i]))||!Array.isArray(cell.groups)||!cell.groups.length||cell.groups.length>32)throw new Error('Around Me data is unavailable.');
    const groups=new Set();for(const group of cell.groups){const id=group.category+'|'+group.publicWorkflowState;if(!keys(group,['category','publicWorkflowState','reportCountBand'])||groups.has(id)||!categories.includes(group.category)||!Object.hasOwn(publicWorkflowLabels,group.publicWorkflowState)||!['5–9','10–19','20–49','50+'].includes(group.reportCountBand))throw new Error('Around Me data is unavailable.');groups.add(id);}
  }return data;
}
