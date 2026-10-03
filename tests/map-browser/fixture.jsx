import React from 'react';
import {createRoot} from 'react-dom/client';
import OperationsPage from '../../src/pages/OperationsPage';
import '../../src/index.css';
createRoot(document.getElementById('root')).render(<>
  <p className="notice" style={{padding:'8px 16px'}}>LOCAL TEST FIXTURE · Synthetic incidents only · No Supabase connection · Realtime not being tested here</p>
  <OperationsPage session={{name:'Browser fixture',userId:'fixture-user'}} operations={{verification_status:'approved',organization_name:'Fixture organization'}} onSwitch={()=>{}} onExit={()=>{}} onRefreshAccess={()=>{}}/>
</>);
