import test from 'node:test';
import assert from 'node:assert/strict';
import {validateConfiguration} from '../src/services/configuration.js';
import {buildReport} from '../src/utils/reportValidation.js';
import {validateAttachment,validatePhoto,PHOTO_LIMIT} from '../src/utils/evidenceValidation.js';
import {submitIncident} from '../src/services/incidentSubmission.js';
import {reportCategories} from '../src/data/reportOptions.js';
import {categories} from '../src/data/mockData.js';
import {evidenceKind} from '../src/utils/evidenceFormat.js';
import {hasOperationsAccess,buildOperationsApplication,nextIncidentStatus,incidentWorkflow} from '../src/utils/workspaceAccess.js';

test('configuration handles missing values and rejects server secrets',()=>{
  assert.match(validateConfiguration(undefined,undefined),/not configured/);
  assert.match(validateConfiguration('invalid','sb_publishable_test'),/valid.*URL/);
  assert.equal(validateConfiguration('https://project.supabase.co','sb_publishable_test'),'');
  const jwt=role=>'header.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.signature';
  assert.match(validateConfiguration('https://project.supabase.co','sb_secret_private'),/server secret/);
  assert.match(validateConfiguration('https://project.supabase.co',jwt('service_role')),/never a service_role/);
  assert.equal(validateConfiguration('https://project.supabase.co',jwt('anon')),'');
});
const input={title:' Broken road ',description:' Large pothole ',area:' Gulshan ',category:'road_damage',latitude:24.8,longitude:67,accuracy:12};
test('all eight canonical categories pass validation and reach the submission RPC unchanged',async()=>{
  const canonical=['traffic','flood','garbage','air_quality','water','power','road_damage','other'];
  assert.deepEqual(reportCategories.map(category=>category.id),canonical);
  assert.deepEqual(categories.map(category=>category.id).sort(),[...canonical].sort());
  for(const category of canonical){
    const client=mockClient();
    await submitIncident(client,buildReport({...input,category},'user'),[photo],'user');
    assert.equal(client.calls[0][1].incident_category,category);
  }
  for(const category of ['roads','electricity','air quality','Traffic','',null]){
    assert.throws(()=>buildReport({...input,category},'user'),/valid category/);
  }
});
test('incident payload requires GPS and excludes privileged fields and supplied ownership',()=>{
  assert.deepEqual(buildReport({...input,priority:'critical',status:'resolved',reporter_id:'forged'},'actual-user'),{
    incident_title:'Broken road',incident_description:'Large pothole',incident_category:'road_damage',
    incident_area:'Gulshan',gps_latitude:24.8,gps_longitude:67,gps_accuracy:12,
  });
  for(const mutation of [{title:' '},{area:' '},{category:'admin'},{latitude:null},{longitude:undefined},{latitude:91},{accuracy:NaN},{accuracy:-1}]){
    assert.throws(()=>buildReport({...input,...mutation},'actual-user'));
  }
});
test('photo validation rejects spoofed image types and unsupported/oversized/empty files',async()=>{
  const jpeg=new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'});
  await validatePhoto(jpeg);
  await assert.rejects(()=>validatePhoto(new Blob(['not an image'],{type:'image/jpeg'})),/not a supported image/);
  assert.throws(()=>validateAttachment({type:'image/jpeg',size:PHOTO_LIMIT+1},'photo'));
  assert.throws(()=>validateAttachment({type:'image/svg+xml',size:100},'photo'));
  assert.throws(()=>validateAttachment({type:'image/png',size:0},'photo'));
  assert.equal(validateAttachment(new Blob(['voice'],{type:'audio/webm;codecs=opus'}),'audio'),'audio/webm');
});
function mockClient({uploadError=false,finalizeError=false,finalizeThrows=false,state='draft',stateError=false,cleanupError=false}={}){
  const calls=[];
  const client={
    calls,
    rpc:async(name,args)=>{
      calls.push([name,args]);
      if(name==='nigraan_finalize_incident'&&finalizeThrows)throw new Error('Network response lost');
      if(name==='nigraan_finalize_incident'&&finalizeError)return {error:finalizeError instanceof Error?finalizeError:new Error('Finalize failed')};
      return {data:args.incident||args.incident_id,error:null};
    },
    storage:{from:()=>({
      upload:async(path,file,options)=>{calls.push(['upload',path,options]);return {error:uploadError?new Error('Upload failed'):null}},
      remove:async(paths)=>{calls.push(['remove',paths]);return {error:cleanupError?new Error('Cleanup failed'):null}},
    })},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:state?{submission_state:state}:null,error:stateError?new Error('Offline'):null})})})}),
  };
  return client;
}
const photo={file:new Blob([new Uint8Array([255,216,255])],{type:'image/jpeg'}),source:'upload'};
test('success uploads photo/optional voice before committing the incident',async()=>{
  const client=mockClient();
  const id=await submitIncident(client,buildReport(input,'user'),[photo,{file:new Blob(['voice'],{type:'audio/webm;codecs=opus'}),source:'recording'}],'user');
  assert.equal(typeof id,'string');
  assert.deepEqual(client.calls.map(c=>c[0]),['nigraan_begin_incident','upload','upload','nigraan_finalize_incident']);
  const records=client.calls.at(-1)[1].attachments;
  assert.equal(records.length,2);
  assert.match(records[0].storage_path,new RegExp('^user/'+id+'/'));
  assert.equal(records[1].source,'recording');
});
test('upload failure cleans all attempted paths before abandoning only the draft',async()=>{
  const client=mockClient({uploadError:true});
  await assert.rejects(()=>submitIncident(client,{},[photo],'user'),/Upload failed/);
  assert.deepEqual(client.calls.map(c=>c[0]),['nigraan_begin_incident','upload','remove','nigraan_abandon_draft']);
});
test('lost finalize response preserves a successfully finalized incident and evidence',async()=>{
  const client=mockClient({finalizeError:true,state:'submitted'});
  await submitIncident(client,{},[photo],'user');
  assert.ok(!client.calls.some(c=>c[0]==='remove'||c[0]==='nigraan_abandon_draft'));
});
test('unconfirmed outcome or failed cleanup is surfaced without deleting more records',async()=>{
  const unknown=mockClient({finalizeError:true,stateError:true});
  await assert.rejects(()=>submitIncident(unknown,{},[photo],'user'),/outcome could not be confirmed/);
  assert.ok(!unknown.calls.some(c=>c[0]==='remove'));
  const cleanup=mockClient({uploadError:true,cleanupError:true});
  await assert.rejects(()=>submitIncident(cleanup,{},[photo],'user'),/could not be fully cleaned/);
  assert.ok(!cleanup.calls.some(c=>c[0]==='nigraan_abandon_draft'));
});
test('rejected finalization removes uploads before abandoning the draft',async()=>{
  const client=mockClient({finalizeError:true});
  await assert.rejects(()=>submitIncident(client,{},[photo],'user'),/Finalize failed/);
  assert.deepEqual(client.calls.map(c=>c[0]),['nigraan_begin_incident','upload','nigraan_finalize_incident','remove','nigraan_abandon_draft']);
});
test('database evidence CHECK failure cleans every newly uploaded photo/audio path',async()=>{
  const message='new row for relation "evidence" violates check constraint "evidence_media_type_check"';
  const client=mockClient({finalizeError:new Error(message)});
  await assert.rejects(()=>submitIncident(client,{},[photo,{file:new Blob(['voice'],{type:'audio/webm'}),source:'recording'}],'user'),error=>error.message===message);
  const uploaded=client.calls.filter(call=>call[0]==='upload').map(call=>call[1]);
  assert.deepEqual(client.calls.find(call=>call[0]==='remove')[1],uploaded);
  assert.equal(client.calls.at(-1)[0],'nigraan_abandon_draft');
});
test('thrown finalize errors clean confirmed drafts but preserve committed or unconfirmed evidence',async()=>{
  const draft=mockClient({finalizeThrows:true});
  await assert.rejects(()=>submitIncident(draft,{},[photo],'user'),/Network response lost/);
  assert.ok(draft.calls.some(call=>call[0]==='remove'));
  const submitted=mockClient({finalizeThrows:true,state:'submitted'});
  await submitIncident(submitted,{},[photo],'user');
  assert.ok(!submitted.calls.some(call=>call[0]==='remove'));
  const unknown=mockClient({finalizeError:true,state:'unexpected'});
  await assert.rejects(()=>submitIncident(unknown,{},[photo],'user'),/could not be confirmed/);
  assert.ok(!unknown.calls.some(call=>call[0]==='remove'));
});
test('upload MIME is normalized; evidence kind/MIME are never supplied to finalizer by browser',async()=>{
  for(const mime of ['image/jpeg','image/png','image/webp','audio/webm','audio/ogg','audio/mp4']){
    const client=mockClient();
    const source=mime.startsWith('image/')?'camera':'recording';
    await submitIncident(client,{},[{file:new Blob(['test'],{type:mime+';codecs=test'}),source,media_type:'forged',mime_type:'forged'}],'user');
    assert.equal(client.calls.find(call=>call[0]==='upload')[2].contentType,mime);
    assert.deepEqual(Object.keys(client.calls.at(-1)[1].attachments[0]).sort(),['source','storage_path']);
  }
});
test('evidence previews support canonical kinds and legacy MIME-valued rows',()=>{
  for(const kind of ['image','audio']){
    assert.equal(evidenceKind({media_type:kind}),kind);
    assert.equal(evidenceKind({media_type:kind+'/test'}),kind);
    assert.equal(evidenceKind({media_type:'legacy',mime_type:kind+'/test'}),kind);
  }
  for(const file of [null,{}, {media_type:null}, {media_type:'video'}])assert.equal(evidenceKind(file),null);
});
test('workspace access follows database approval independently of legacy account type',()=>{
  for(const account_type of ['citizen','operations']){
    const profile={id:'user',account_type};
    for(const verification_status of ['pending','rejected'])assert.equal(hasOperationsAccess({profile,operations:{verification_status}}),false);
    assert.equal(hasOperationsAccess({profile,operations:null}),false);
    assert.equal(hasOperationsAccess({profile,operations:{verification_status:'approved'}}),true);
  }
  assert.equal(hasOperationsAccess({operations:{verification_status:'approved'}}),false);
  assert.equal(hasOperationsAccess({profile:{id:'user'},user_metadata:{verification_status:'approved'}}),false);
});
test('Operations application validates organization fields and cannot request approval or target another identity',()=>{
  assert.deepEqual(buildOperationsApplication({organizationName:' City NGO ',organizationType:'ngo',explanation:' City work ',verification_status:'approved',user_id:'other'}),{
    organization_name:'City NGO',organization_type:'ngo',explanation:'City work',
  });
  for(const type of ['government','ngo','civic_organization','utility','volunteer_group','other']){
    assert.equal(buildOperationsApplication({organizationName:'Organization',organizationType:type}).organization_type,type);
  }
  for(const mutation of [{organizationName:''},{organizationName:'a'.repeat(201)},{organizationType:'admin'},{explanation:'a'.repeat(1001)}]){
    assert.throws(()=>buildOperationsApplication({organizationName:'NGO',organizationType:'ngo',...mutation}));
  }
});
test('Operations workflow advances sequentially and leaves resolved/unknown statuses terminal',()=>{
  assert.deepEqual(incidentWorkflow,['reported','acknowledged','assigned','in_progress','resolved']);
  assert.deepEqual(incidentWorkflow.map(nextIncidentStatus),['acknowledged','assigned','in_progress','resolved',null]);
  assert.equal(nextIncidentStatus('submitted'),null);
});
