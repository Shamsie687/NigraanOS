import test from 'node:test';
import assert from 'node:assert/strict';
import {citizenAction,citizenFields} from '../src/utils/citizenChanges.js';
import {submitCitizenChange} from '../src/services/citizenChangeSubmission.js';
test('Citizen actions lock original edits after acknowledgement and resolved is read-only',()=>{
  assert.equal(citizenAction('reported'),'Edit Report');for(const status of ['acknowledged','assigned','in_progress'])assert.equal(citizenAction(status),'Add Update');for(const status of ['resolved','legacy'])assert.equal(citizenAction(status),'View Details');
});
test('edit payload retains exact GPS/category and strips protected browser fields',()=>{
  const fields=citizenFields({title:' Correction ',description:' تفصیل ',area:'Area',category:'water',latitude:24.8,longitude:67,status:'resolved',priority:'critical',assigned_organization_id:'forged'});
  assert.equal(fields.status,undefined);assert.equal(fields.priority,undefined);assert.equal(fields.assigned_organization_id,undefined);assert.equal(fields.description,'تفصیل');assert.equal(fields.latitude,24.8);
  assert.throws(()=>citizenFields({...fields,latitude:null}));assert.throws(()=>citizenFields({...fields,category:'invalid'}));
});
function client({finalError=false,outcome='draft',outcomeError=false,cleanupError=false}={}){
  const calls=[];
  return {calls,rpc:async(name,args)=>{calls.push([name,args]);return name==='nigraan_finalize_citizen_change'&&finalError?{error:{message:'This report is already being processed'}}:{data:args.change_id};},
    functions:{invoke:async(name,{body})=>{calls.push(['bind',body]);return {data:{bound:true}};}},
    storage:{from:()=>({upload:async(path,file,options)=>{calls.push(['upload',path,options]);return {};},remove:async paths=>{calls.push(['remove',paths]);return cleanupError?{error:true}:{};}})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:outcome?{submission_state:outcome}:null,error:outcomeError})})})})};
}
const input={incidentId:'incident',kind:'update',body:'The water has increased.'};
const photo={file:new Blob(['photo'],{type:'image/jpeg'}),source:'upload'};
test('text-only update is real RPC-based and evidence/transcript upload uses the private change draft',async()=>{
  const plain=client();await submitCitizenChange(plain,input,[],'user');assert.deepEqual(plain.calls.map(call=>call[0]),['nigraan_begin_citizen_change','nigraan_finalize_citizen_change']);
  const audio={file:new Blob(['audio'],{type:'audio/webm;codecs=opus'}),source:'recording',transcription:{jobId:'receipt',text:'نئی اطلاع',reviewed:true}};
  const attachments=client();await submitCitizenChange(attachments,input,[photo,audio],'user');const id=attachments.calls[0][1].change_id;
  assert.ok(attachments.calls.find(call=>call[0]==='upload')[1].startsWith('user/incident/'+id+'/'));
  const records=attachments.calls.at(-1)[1].attachments;assert.equal(records[1].transcript,'نئی اطلاع');assert.equal(records[1].transcript_reviewed,true);assert.equal(records[0].media_type,undefined);
});
test('status-race rejection cleans newly uploaded files but lost/unknown outcomes preserve committed evidence',async()=>{
  const failed=client({finalError:true});await assert.rejects(()=>submitCitizenChange(failed,input,[photo],'user'),/already being processed/);assert.ok(failed.calls.some(call=>call[0]==='remove'));assert.ok(failed.calls.some(call=>call[0]==='nigraan_abandon_citizen_change'));
  const committed=client({finalError:true,outcome:'published'});await submitCitizenChange(committed,input,[photo],'user');assert.ok(!committed.calls.some(call=>call[0]==='remove'));
  const unknown=client({finalError:true,outcomeError:true});await assert.rejects(()=>submitCitizenChange(unknown,input,[photo],'user'),/confirm/);assert.ok(!unknown.calls.some(call=>call[0]==='remove'));
});
