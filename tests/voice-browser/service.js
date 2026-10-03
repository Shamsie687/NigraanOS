// Isolated UI-test service only. No credentials or external provider requests.
let fail=true;
export const setFailure=value=>{fail=value;};
export async function transcribeEvidence(_audio,language,signal) {
  await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,900);signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelled'));},{once:true});});
  if(fail)throw new Error('Synthetic test failure. Recording retained.');
  return {jobId:'00000000-0000-4000-8000-000000000002',text:'یہ صرف مقامی آزمائشی متن ہے۔ Test fixture only.',detectedLanguage:language==='en'?'english':'urdu'};
}
