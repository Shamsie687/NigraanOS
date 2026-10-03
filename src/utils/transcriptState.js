export const TRANSCRIPT_LIMIT = 12000;
export const emptyTranscript = () => ({status:'idle', text:'', machineText:'', jobId:null, selectedLanguage:'auto', detectedLanguage:null, reviewed:false, error:''});
export function transcriptReducer(state, action) {
  switch (action.type) {
    case 'reset': return emptyTranscript();
    case 'language': return {...emptyTranscript(), selectedLanguage:action.value};
    case 'start': return {...state, status:'loading', error:''};
    case 'success': return {...state, status:'ready', text:action.result.text, machineText:action.result.text, jobId:action.result.jobId, detectedLanguage:action.result.detectedLanguage, reviewed:false, error:''};
    case 'failure': return {...state, status:'failed', error:action.message};
    case 'edit': return {...state, text:action.value, reviewed:true};
    case 'review': return {...state, reviewed:action.value};
    case 'skip': return {...emptyTranscript(), status:'skipped', selectedLanguage:state.selectedLanguage};
    default: return state;
  }
}
export function submissionTranscript(state) {
  if (!state.jobId || !state.text.trim()) return {status:state.status==='failed'?'failed':'not_connected'};
  if (state.text.length>TRANSCRIPT_LIMIT) throw new Error('Transcript exceeds 12,000 characters.');
  return {jobId:state.jobId, text:state.text, reviewed:state.reviewed || state.text!==state.machineText};
}
