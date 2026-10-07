const time=value=>new Date(value).toLocaleString();
export default function CitizenAccountability({data,error,updatedAt,onRefresh}) {
  return <section className="report-progress" aria-label="Operations accountability"><h3>Operations progress</h3>
    <button type="button" onClick={onRefresh}>Refresh progress</button>
    {updatedAt&&<p className="muted">Last successful refresh: {time(updatedAt)}</p>}
    {error&&<p role="alert">{error}</p>}
    {!data&&!error&&<p role="status">Loading recorded progress…</p>}
    {data?.legacyHistory&&<p className="muted">Detailed progress history is recorded for activity after accountability tracking was introduced. Earlier transition times are unavailable.</p>}
    {data?.organization&&<><h4>Assigned Operations organization</h4><p dir="auto">{data.organization.name}</p><p className="muted">Assignment does not confirm dispatch or physical attendance.</p></>}
    {data?.updates?.length>0&&<><h4>Operations updates</h4>{data.updates.map(update=><article key={update.cursor}><strong>{update.kind==='resolution'?'Resolution information':'Progress update'}</strong><p><time dateTime={update.createdAt}>{time(update.createdAt)}</time></p><p dir="auto" className="transcript-text">{update.message}</p></article>)}</>}
    {data&&data.updates.length===0&&<p>No Citizen-visible Operations updates have been recorded.</p>}
    {data&&(data.events.length===50||data.updates.length===50)&&<p className="muted">Showing the latest 50 records in each history.</p>}
  </section>;
}
