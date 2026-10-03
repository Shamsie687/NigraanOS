export const DAY=86400000;
export const PERIODS=[['24h','Previous 24 hours',DAY],['7d','Previous 7 days',7*DAY],['30d','Previous 30 days',30*DAY],['all','All available data',null]];
export const DOMAINS={category:['traffic','flood','garbage','air_quality','water','power','road_damage','other'],status:['reported','acknowledged','assigned','in_progress','resolved'],priority:['low','normal','medium','high','critical']};
export const timestamp=value=>typeof value==='string'&&value.trim()&&Number.isFinite(Date.parse(value))?Date.parse(value):null;
export function analyticsWindow(period,to){const choice=PERIODS.find(([key])=>key===period);if(!choice||!Number.isFinite(to))throw new Error('Invalid analytics window');return {period,label:choice[1],from:choice[2]===null?null:to-choice[2],to,duration:choice[2]};}
export function inWindow(value,window){const t=timestamp(value);return t!==null&&t<window.to&&(window.from===null||t>=window.from);}
export function distribution(rows,field){const domain=DOMAINS[field];const counts=new Map([...domain,'unknown'].map(key=>[key,0]));for(const row of rows){const key=domain.includes(row[field])?row[field]:'unknown';counts.set(key,counts.get(key)+1);}return [...counts].map(([key,count])=>({key,count}));}
function safeIncident(i){return {id:i.id,title:i.title,category:i.category,status:i.status,priority:i.priority,reported_at:i.reported_at};}
export function timeline(rows,window){
  const dates=rows.map(i=>timestamp(i.reported_at)).filter(t=>t!==null&&t<window.to);
  if(window.from===null&&!dates.length)return [];
  const from=window.from??dates.reduce((minimum,t)=>Math.min(minimum,t),Infinity),span=window.to-from;
  const size=window.period==='24h'?4*3600000:window.period==='7d'?DAY:window.period==='30d'?5*DAY:span<=7*DAY?DAY:span<=31*DAY?7*DAY:span<=180*DAY?30*DAY:span<=730*DAY?90*DAY:Math.ceil(span/(8*DAY))*DAY;
  const buckets=Array.from({length:Math.max(1,Math.ceil(span/size))},(_,n)=>({from:from+n*size,to:Math.min(window.to,from+(n+1)*size),count:0}));
  for(const t of dates){if(t>=from){const index=Math.floor((t-from)/size);if(buckets[index])buckets[index].count++;}}
  return buckets;
}
export function categoryComparison(rows,window){
  if(window.duration===null)return null;
  const current=distribution(rows.filter(i=>inWindow(i.reported_at,window)),'category');
  const previous=distribution(rows.filter(i=>inWindow(i.reported_at,{from:window.from-window.duration,to:window.from})),'category');
  return current.map((item,n)=>{const before=previous[n].count,after=item.count;return {key:item.key,current:after,previous:before,difference:after-before,smallSample:before+after<10,percentage:before>=10&&after>=10?100*(after-before)/before:null};});
}
export function calculateAnalytics(incidents,activity,period,to){
  const window=analyticsWindow(period,to);
  // Never copy descriptions, reporter identity, GPS, edit bodies or evidence.
  const all=incidents.filter(i=>i.submission_state==='submitted').map(safeIncident);
  const invalidDates=all.filter(i=>timestamp(i.reported_at)===null||timestamp(i.reported_at)>to).length;
  const cohort=period==='all'?all:all.filter(i=>inWindow(i.reported_at,window));
  const unresolved=all.filter(i=>i.status!=='resolved');
  const ageBands=[{key:'Under 24h',count:0},{key:'24h – under 7d',count:0},{key:'7d – under 30d',count:0},{key:'30d+',count:0},{key:'Unknown age',count:0}];
  for(const i of unresolved){const t=timestamp(i.reported_at),age=t===null?null:to-t;ageBands[age===null||age<0?4:age<DAY?0:age<7*DAY?1:age<30*DAY?2:3].count++;}
  const oldest=unresolved.filter(i=>{const t=timestamp(i.reported_at);return t!==null&&t<=to;}).sort((a,b)=>timestamp(a.reported_at)-timestamp(b.reported_at)||String(a.id).localeCompare(String(b.id))).slice(0,5).map(i=>({...i,ageHours:(to-timestamp(i.reported_at))/3600000}));
  const parents=new Map(all.map(i=>[i.id,i]));
  const events=activity===null?null:[...new Map(activity.filter(c=>parents.has(c.incident_id)&&['edit','update'].includes(c.kind)&&inWindow(c.published_at,window)).map(c=>[c.id,{id:c.id,incident_id:c.incident_id,kind:c.kind,published_at:c.published_at}])).values()];
  return {window,total:cohort.length,unresolved:cohort.filter(i=>i.status!=='resolved').length,resolved:cohort.filter(i=>i.status==='resolved').length,updates:events===null?null:events.filter(c=>c.kind==='update').length,invalidDates,category:distribution(cohort,'category'),status:distribution(cohort,'status'),priority:distribution(cohort,'priority'),timeline:timeline(cohort,window),ageBands,oldest,backlogCount:unresolved.length,recent:events===null?null:events.sort((a,b)=>timestamp(b.published_at)-timestamp(a.published_at)||String(a.id).localeCompare(String(b.id))).slice(0,5).map(c=>({...c,incident:parents.get(c.incident_id)})),comparison:categoryComparison(all,window)};
}
