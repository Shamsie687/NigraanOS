import { useEffect, useState } from 'react';
import { requireSupabase } from '../services/supabase';
import { evidenceKind } from '../utils/evidenceFormat';
import EvidenceTranscript from './EvidenceTranscript';

export default function EvidenceViewer({ incidentId,initiallyOpen=false,changeId=null }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setError(''); setFiles([]);
    const client = requireSupabase();
    (async () => {
      let evidenceQuery = client.from('evidence').select('*').eq('incident_id', incidentId);
      if(changeId) evidenceQuery=evidenceQuery.eq('citizen_change_id',changeId);
      const evidence = await evidenceQuery.order('created_at', { ascending: true });
      if (evidence.error) throw evidence.error;
      const resolved = await Promise.all(evidence.data.filter(file=>(file.citizen_change_id||null)===changeId).map(async file => {
        const result = await client.storage.from('incident-evidence').createSignedUrl(file.storage_path, 120);
        return { ...file, url: result.data?.signedUrl, unavailable: Boolean(result.error) };
      }));
      if (!cancelled) setFiles(resolved);
    })().catch(cause => { if (!cancelled) setError('Unable to load evidence: ' + cause.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, incidentId,changeId]);
  return <div className="evidence-viewer">
    <button onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide evidence' : 'View evidence'}</button>
    {open && <div>
      <small className="muted">Private previews expire after 2 minutes. Close and reopen to refresh.</small>
      {loading && <p role="status">Loading evidence…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!loading && !error && !files.length && <p className="muted">No evidence attached to this legacy incident.</p>}
      {files.map(file => <div key={file.id}>
        {file.unavailable ? <p className="muted">Preview unavailable. Legacy evidence may use a different storage bucket.</p> : evidenceKind(file) === 'image' ? <img src={file.url} alt="Incident photo evidence" /> : evidenceKind(file) === 'audio' ? <audio controls src={file.url} /> : <p className="muted">Unsupported legacy evidence format.</p>}
        {evidenceKind(file) === 'audio' && <EvidenceTranscript file={file} />}
      </div>)}
    </div>}
  </div>;
}
