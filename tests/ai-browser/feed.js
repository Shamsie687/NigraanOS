import {incident} from './client';
export default function useOperationalIncidents(){return {reports:[incident],total:1,loading:false,error:'',realtimeStatus:'fallback',lastUpdated:new Date(),refresh:async()=>{}};}
