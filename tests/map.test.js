import test from 'node:test';
import assert from 'node:assert/strict';
import {hasValidCoordinates,filterMapIncidents,markerPresentation,prioritizeIncidents,categoryStyles} from '../src/utils/incidentMap.js';
import {fetchMapIncidents,observeIncidentChanges} from '../src/services/incidentMapData.js';
import {city} from '../src/config/city.js';
const sample={id:'real-id',title:'Water incident',category:'water',latitude:24.861,longitude:67.002,status:'reported',priority:'normal',reported_at:'2026-10-02T00:00:00Z'};
test('map uses exact GPS, rejects missing/non-numeric/out-of-range values, and does not invent coordinates',()=>{
  assert.ok(hasValidCoordinates(sample));
  assert.ok(hasValidCoordinates({...sample,latitude:0,longitude:0}));
  assert.ok(hasValidCoordinates({...sample,latitude:-90,longitude:180}));
  for(const mutation of [{latitude:null},{longitude:undefined},{latitude:'24.8'},{latitude:91},{longitude:181},{latitude:NaN},{longitude:Infinity}])assert.equal(hasValidCoordinates({...sample,...mutation}),false);
  const invalid={...sample,id:'bad',latitude:null};
  assert.deepEqual(filterMapIncidents([sample,invalid]),[sample]);
  assert.equal(invalid.latitude,null);
  assert.deepEqual(city.center,[24.8607,67.0011]);
});
test('every canonical category and workflow filter selects the correct real markers',()=>{
  const rows=Object.keys(categoryStyles).map((category,index)=>({...sample,id:String(index),category,status:index%2?'resolved':'reported'}));
  for(const category of Object.keys(categoryStyles))assert.equal(filterMapIncidents(rows,{category}).length,1);
  assert.equal(filterMapIncidents(rows,{status:'resolved'}).length,4);
  assert.equal(filterMapIncidents(rows,{category:'traffic',status:'resolved'}).length,0);
  assert.equal(filterMapIncidents(rows).length,8);
});
test('marker category/priority HTML tokens are allowlisted and resolved markers are distinct',()=>{
  assert.equal(markerPresentation({...sample,priority:'critical'}).urgency,'critical');
  assert.equal(markerPresentation({...sample,status:'resolved'}).resolved,true);
  const malicious=markerPresentation({...sample,category:'"><script>attack</script>',priority:'evil'});
  assert.equal(malicious.category,'other');assert.equal(malicious.urgency,'standard');
});
test('priority panel sorts real unresolved critical/high first and never creates filler',()=>{
  const rows=[{...sample,id:'normal'}, {...sample,id:'high',priority:'high'}, {...sample,id:'critical',priority:'critical'}, {...sample,id:'resolved',priority:'critical',status:'resolved'}];
  assert.deepEqual(prioritizeIncidents(rows).map(row=>row.id),['critical','high','normal']);
  assert.deepEqual(prioritizeIncidents([]),[]);
  assert.deepEqual(rows.map(row=>row.id),['normal','high','critical','resolved']);
});
function queryClient(rows,{failure=false}={}) {
  const calls=[];
  return {calls,from:table=>{
    calls.push(['from',table]);let start,end;
    const query={
      select:columns=>{calls.push(['select',columns]);return query;},
      eq:(column,value)=>{calls.push(['eq',column,value]);return query;},
      order:()=>query,range:(first,last)=>{start=first;end=last;calls.push(['range',first,last]);return query;},
      abortSignal:signal=>{calls.push(['signal',signal]);return query;},
      then:resolve=>Promise.resolve({data:rows.slice(start,end+1),error:failure?new Error('Read denied'):null}).then(resolve),
    };return query;
  }};
}
test('map reads all submitted pages through authenticated queries without evidence URLs',async()=>{
  const rows=Array.from({length:1201},(_,index)=>({...sample,id:String(index)}));
  const client=queryClient(rows);
  const loaded=await fetchMapIncidents(client);
  assert.equal(loaded.length,1201);
  assert.deepEqual(client.calls.filter(call=>call[0]==='range'),[['range',0,499],['range',500,999],['range',1000,1499]]);
  assert.ok(client.calls.filter(call=>call[0]==='eq').every(call=>call[1]==='submission_state'&&call[2]==='submitted'));
  assert.ok(!client.calls.find(call=>call[0]==='select')[1].includes('storage_path'));
  assert.deepEqual(loaded[0],rows[0]);
  await assert.rejects(()=>fetchMapIncidents(queryClient([],{failure:true})),/Read denied/);
  await assert.rejects(()=>fetchMapIncidents(client,{signal:{aborted:true}}),/cancelled/);
});
test('Realtime subscribes to INSERT/UPDATE, refetches on join, debounces events and cleans up',()=>{
  const handlers=[],states=[],pending=new Map();let subscription,removed=false,refreshes=0,timerId=0;
  const channel={on:(type,filter,callback)=>{handlers.push({type,filter,callback});return channel;},subscribe:callback=>{subscription=callback;return channel;}};
  const client={channel:()=>channel,removeChannel:value=>{assert.equal(value,channel);removed=true;return Promise.resolve();}};
  const stop=observeIncidentChanges(client,()=>refreshes++,state=>states.push(state),{
    schedule:callback=>{pending.set(++timerId,callback);return timerId;},cancel:id=>pending.delete(id),
  });
  assert.deepEqual(handlers.map(handler=>handler.filter.event),['INSERT','UPDATE']);
  assert.ok(handlers.every(handler=>handler.filter.table==='incidents'&&handler.filter.filter==='submission_state=eq.submitted'));
  subscription('SUBSCRIBED');assert.equal(refreshes,1);assert.equal(states.at(-1),'connected');
  handlers[0].callback({new:{id:'new'}});handlers[1].callback({new:{id:'new',status:'acknowledged'}});
  assert.equal(pending.size,1);assert.equal(states.at(-1),'receiving');
  pending.values().next().value();assert.equal(refreshes,2);
  subscription('CHANNEL_ERROR');assert.equal(states.at(-1),'fallback');
  handlers[1].callback({});stop();assert.ok(removed);
  const count=states.length;handlers[0].callback({});subscription('SUBSCRIBED');assert.equal(states.length,count);
});
test('Realtime setup failure is explicit and leaves polling fallback possible',()=>{
  const states=[];
  const stop=observeIncidentChanges({channel:()=>{throw new Error('Unavailable');}},()=>{},state=>states.push(state));
  assert.deepEqual(states,['fallback']);stop();
});
