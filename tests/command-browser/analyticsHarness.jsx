// Test-only controls for lifecycle/empty/read-failure cases, never production.
import {useState} from 'react';
import OperationsAnalytics from '../../src/components/OperationsAnalytics';
import {rows} from './client';
export default function Harness(){const [account,setAccount]=useState('first'),[visible,setVisible]=useState(true),[reports,setReports]=useState(rows),[to,setTo]=useState(()=>new Date()),[error,setError]=useState('');const refresh=async()=>setTo(new Date());return <><nav><button onClick={()=>{setAccount('second');setReports([]);}}>Change account</button><button onClick={()=>setVisible(!visible)}>Change workspace</button><button onClick={()=>{setReports([]);setTo(new Date());}}>Empty dataset</button><button onClick={()=>setError('read denied')}>Incident failure</button></nav>{visible&&<OperationsAnalytics feed={{reports,lastUpdated:to,loading:false,error,refresh}} accountId={account} onSelect={()=>{}}/>}</>;}
