import React from 'react';
import {createRoot} from 'react-dom/client';
import OperationsPage from '../../src/pages/OperationsPage';
import '../../src/index.css';
import {testState} from './client';
function Fixture(){const [open,setOpen]=React.useState(true),[stats,setStats]=React.useState({...testState});React.useEffect(()=>{const timer=setInterval(()=>setStats({...testState}),100);return()=>clearInterval(timer);},[]);return <><div style={{padding:12,background:'#512b25',color:'white',overflowWrap:'anywhere'}}><strong>ISOLATED AUTOMATED TEST ONLY · no real AI or database</strong><button onClick={()=>setOpen(!open)}>{open?'Unmount workspace':'Mount workspace'}</button><button onClick={()=>testState.mode='failure'}>Test provider failure</button><button onClick={()=>testState.mode='slow'}>Test slow request</button><output style={{display:'block',overflowWrap:'anywhere'}} data-testid="test-state">{JSON.stringify(stats)}</output></div>{open&&<OperationsPage session={{name:'Automated fixture',userId:'test-only'}} operations={{verification_status:'approved'}} onSwitch={()=>setOpen(false)} onRefreshAccess={()=>{}} onExit={()=>setOpen(false)}/>}</>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
