import {useCallback,useState} from 'react';
import {rows} from './client';
export default function useFixtureFeed(){
  const [reports,setReports]=useState(()=>rows.map(row=>({...row})));
  const refresh=useCallback(async()=>setReports(rows.map(row=>({...row}))),[]);
  return {reports,total:reports.length,loading:false,error:'',refresh,realtimeStatus:'fallback',lastUpdated:new Date('2026-10-02T00:00:00Z')};
}
