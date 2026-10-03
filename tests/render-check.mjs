import {createServer} from 'vite';
import {renderToString} from 'react-dom/server';
import React from 'react';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {default:EntryPage}=await server.ssrLoadModule('/src/pages/EntryPage.jsx');
  const {default:IncidentForm}=await server.ssrLoadModule('/src/components/IncidentForm.jsx');
  const {default:OperationsApplication}=await server.ssrLoadModule('/src/components/OperationsApplication.jsx');
  const {default:WorkspaceSwitcher}=await server.ssrLoadModule('/src/components/WorkspaceSwitcher.jsx');
  const {default:IncidentDetail}=await server.ssrLoadModule('/src/components/IncidentDetail.jsx');
  const {default:CitizenChangeForm}=await server.ssrLoadModule('/src/components/CitizenChangeForm.jsx');
  const {default:CitizenReportDetail}=await server.ssrLoadModule('/src/components/CitizenReportDetail.jsx');
  const entry=renderToString(React.createElement(EntryPage));
  if(!entry.includes('Sign in')||entry.includes('Open citizen demo'))throw new Error('Entry rendering failed');
  if(!entry.includes('Create account')||entry.includes('Choose how you connect')||entry.includes('portal-options'))throw new Error('Entry still separates account types');
  const application=renderToString(React.createElement(OperationsApplication,{operations:null,onRefresh:()=>{}}));
  for(const text of ['Apply for Operations Access','Organization Name','Organization Type','How does your organization'])if(!application.includes(text))throw new Error('Missing Operations application field');
  const pending=renderToString(React.createElement(OperationsApplication,{operations:{verification_status:'pending',organization_name:'Test NGO'},onRefresh:()=>{}}));
  if(!pending.includes('Pending Verification')||pending.includes('Submit application'))throw new Error('Pending application presentation failed');
  const switcher=renderToString(React.createElement(WorkspaceSwitcher,{workspace:'operations',operations:{verification_status:'approved'},onSwitch:()=>{},onRefresh:()=>{}}));
  if(!switcher.includes('Citizen')||!switcher.includes('Operations')||switcher.includes('· Apply'))throw new Error('Approved workspace switcher failed');
  const detail=renderToString(React.createElement(IncidentDetail,{incident:{id:'real-reference',title:'Real incident',category:'water',status:'reported',priority:'normal',description:'Real description',area:'Test area',latitude:24.8,longitude:67,reported_at:'2026-10-02T00:00:00Z'},onClose:()=>{},onUpdated:()=>{}}));
  for(const text of ['REAL CITIZEN INCIDENT','Real incident','Real description','Test area','24.8','Mark Acknowledged'])if(!detail.includes(text))throw new Error('Incident detail missing '+text);
  if(detail.includes('Hide evidence'))throw new Error('Duplicate evidence viewer outside activity');
  if(!detail.includes('Citizen report activity'))throw new Error('Operations activity missing');
  const sample={id:'test-reference',title:'Original title',description:'Original description',area:'Test area',category:'water',status:'reported',latitude:24.8,longitude:67,updated_at:'2026-10-02T00:00:00Z'};
  const edit=renderToString(React.createElement(CitizenChangeForm,{incident:sample,kind:'edit',userId:'test'}));
  for(const text of ['Edit Report','name="title"','name="description"','name="category"','Use my current location','Existing evidence stays intact'])if(!edit.includes(text))throw new Error('Edit form missing '+text);
  for(const field of ['status','priority','assigned_organization_id'])if(edit.includes('name="'+field+'"'))throw new Error('Protected field editable');
  const update=renderToString(React.createElement(CitizenChangeForm,{incident:{...sample,status:'acknowledged'},kind:'update',userId:'test'}));
  if(!update.includes('name="body"')||update.includes('name="title"')||!update.includes('Earlier updates and the original report cannot be rewritten'))throw new Error('Update form mutates original');
  const resolved=renderToString(React.createElement(CitizenReportDetail,{report:{...sample,status:'resolved'},userId:'test'}));
  if(!resolved.includes('Completed · Read-only')||resolved.includes('>Edit Report<')||resolved.includes('>Add Update<'))throw new Error('Resolved report not read-only');
  const form=renderToString(React.createElement(IncidentForm,{userId:'test',onSaved:()=>{},onBusy:()=>{}}));
  for(const label of ['Use my current location','Take Photo','Upload Photo','Optional transcription becomes available','capture="environment"']){
    if(!form.includes(label))throw new Error('Incident form missing '+label);
  }
  if(!form.includes('disabled=""'))throw new Error('Submission must be disabled before GPS and photo');
  await mkdir('review',{recursive:true});
  const css=await readFile('src/index.css','utf8');
  await writeFile('review/incident-form.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NigraanOS incident form preview</title><style>'+css+'</style></head><body><main class="citizen-main"><p class="muted">Local form preview · no live account or permissions requested</p>'+form+'</main></body></html>');
  await writeFile('review/citizen-correction-preview.html','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NigraanOS correction layout preview</title><style>'+css+'</style></head><body><main class="citizen-main"><p class="verification-note">STATIC LOCAL LAYOUT PREVIEW · Synthetic report fields · No backend requests · Buttons are not interactive</p>'+edit+update+resolved+'</main></body></html>');
  console.log('Entry and evidence form render; GPS/photo gating, camera input and optional server-side transcription labels verified.');
}finally{await server.close();}

