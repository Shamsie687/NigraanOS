import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {renderToString} from 'react-dom/server';
import React from 'react';
const server=await createServer({envFile:false,server:{middlewareMode:true},appType:'custom'});
try{
 const {default:Panel}=await server.ssrLoadModule('/src/components/JudgeAccess.jsx');
 const render=access=>renderToString(React.createElement(Panel,{access,onRefresh(){},onOperations(){}}));
 assert.match(render({permanent:false,allowed:false}),/Request Temporary Operations Access/);
 for(const status of ['pending','rejected','expired','revoked']){
  const html=render({permanent:false,allowed:false,status});assert.ok(!html.includes('Open Operations'));
  assert.ok(!html.includes('Request Temporary Operations Access'));
 }
 const pendingActivation=render({permanent:false,allowed:false,status:'approved',activation_expires_at:new Date(Date.now()+172800000).toISOString()});assert.ok(pendingActivation.includes('Start My 60-Minute Access'));assert.ok(!pendingActivation.includes('Open Operations'));
 const approved=render({permanent:false,allowed:true,status:'active',server_now:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),receivedAt:performance.now()});
 assert.ok(approved.includes('Open Operations'));assert.ok(approved.includes('activated access'));
 assert.equal(render({permanent:true,allowed:true}),'');
 const {default:Application}=await server.ssrLoadModule('/src/components/OperationsApplication.jsx');
 const {default:Switcher}=await server.ssrLoadModule('/src/components/WorkspaceSwitcher.jsx');
 const operations={verification_status:'pending',organization_name:'Synthetic organization'};
 for(const status of ['pending','approved','active','expired','revoked','rejected']){
  const access={permanent:false,allowed:status==='active',status};
  const application=renderToString(React.createElement(Application,{operations,access,onRefresh(){}}));
  assert.match(application,/Permanent Operations application \(separate from judge access\)/);
  assert.match(application,/Only your permanent application is awaiting/);
  assert.match(application,/does not change your temporary judge access/);
  assert.ok(!application.includes('Your application is awaiting project-owner approval.'));
  const switcher=renderToString(React.createElement(Switcher,{workspace:'citizen',operations,access,onSwitch(){},onRefresh(){}}));
  assert.ok(!switcher.includes('Pending verification'));
  if(status==='approved'){assert.match(switcher,/Ready to start/);assert.ok(!render(access).includes('Open Operations'));}
  if(['expired','revoked'].includes(status))assert.match(switcher,/Operations session ended/);
  if(['approved','active','expired'].includes(status))assert.ok(!render(access).includes('Administrator approval is required'));
 }
 const permanent=renderToString(React.createElement(Application,{operations:{...operations,verification_status:'approved'},access:{permanent:true,allowed:true,admin:true},onRefresh(){}}));
 assert.match(permanent,/Permanent Operations access approved/);
 const ordinary=renderToString(React.createElement(Application,{operations,onRefresh(){}}));
 assert.match(ordinary,/Pending Verification/);assert.ok(!ordinary.includes('Submit application'));
 const {default:Admin}=await server.ssrLoadModule('/src/pages/JudgeAdminPage.jsx');
 const html=renderToString(React.createElement(Admin,{onExit(){}}));assert.match(html,/Judge access review/);assert.ok(!html.includes('apiKey'));
 console.log('Judge request/admin render checks: PASS (no browser or hosted calls)');
}finally{await server.close();}
