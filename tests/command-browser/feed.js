import {useState,useCallback} from 'react';
import {rows} from './client';
export default function useFeed(){const [reports,setReports]=useState(()=>rows.map(r=>({...r})));const [lastUpdated,setUpdated]=useState(()=>new Date());const refresh=useCallback(async()=>{setReports(rows.map(r=>({...r})));setUpdated(new Date());},[]);return {reports,total:reports.length,loading:false,error:'',realtimeStatus:'fallback',lastUpdated,refresh};}
