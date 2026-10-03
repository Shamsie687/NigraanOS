import {commandSummary} from '../utils/commandCenter';
export default function CommandSummary({incidents,loading,error,asOf}){
  const counts=commandSummary(incidents,asOf?.getTime()||Date.now());
  const end=asOf?.getTime()||Date.now();
  return <section className="command-summary" aria-label="Authorized incident summary">{[['Active incidents','active'],['Awaiting acknowledgement','awaiting'],['In progress','inProgress'],['New reports · 24h','newReports']].map(([label,key])=><article key={key} title={key==='newReports'?'Reported between '+new Date(end-86400000).toISOString()+' and '+new Date(end).toISOString():undefined}><span>{label}</span><strong>{error?'—':loading&&!asOf?'…':counts[key]}</strong></article>)}</section>;
}
