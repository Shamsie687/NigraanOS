import React from 'react';
import {createRoot} from 'react-dom/client';
import OperationsPage from '../../src/pages/OperationsPage';
import CitizenPage from '../../src/pages/CitizenPage';
import '../../src/index.css';
import AnalyticsHarness from './analyticsHarness';
const Page=location.search.includes('citizen')?'CitizenPage':'OperationsPage';
const Component=Page==='CitizenPage'?CitizenPage:OperationsPage;
createRoot(document.getElementById('root')).render(<><div style={{position:'fixed',bottom:0,right:0,zIndex:2000,background:'#142333',color:'#d6e2ec',padding:'5px 10px',fontSize:10}}>LOCAL UI FIXTURE · Synthetic data · No Supabase</div>{location.search.includes('harness')?<AnalyticsHarness/>:<Component session={{name:'Ayesha Noor',userId:'fixture-user'}} operations={{verification_status:'approved',organization_name:'Fixture organization'}} onSwitch={()=>{}} onExit={()=>{}} onRefreshAccess={()=>{}}/>}</>);
