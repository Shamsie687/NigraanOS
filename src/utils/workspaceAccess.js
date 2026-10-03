import {organizationTypes} from '../data/reportOptions.js';
export function hasOperationsAccess(account) {
  return Boolean(account?.profile && account.operations?.verification_status === 'approved');
}
export function buildOperationsApplication({organizationName,organizationType,explanation=''}) {
  const name=String(organizationName || '').trim();
  const detail=String(explanation || '').trim();
  if (!name || name.length>200) throw new Error('Enter an organization name up to 200 characters.');
  if (!organizationTypes.some(([id])=>id===organizationType)) throw new Error('Choose a valid organization type.');
  if (detail.length>1000) throw new Error('Keep the explanation within 1000 characters.');
  return {organization_name:name,organization_type:organizationType,explanation:detail || null};
}
export const incidentWorkflow=['reported','acknowledged','assigned','in_progress','resolved'];
export function nextIncidentStatus(status) {
  const index=incidentWorkflow.indexOf(status);
  return index<0?null:incidentWorkflow[index+1] || null;
}
