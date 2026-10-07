import {requireSupabase} from './supabase';
import {buildOperationsApplication,nextIncidentStatus} from '../utils/workspaceAccess';
export async function applyOperations(input) {
  const {data,error}=await requireSupabase().rpc('nigraan_apply_operations',buildOperationsApplication(input));
  if (error) throw error;
  return data;
}
export async function updateIncidentStatus(incident) {
  const next=nextIncidentStatus(incident.status);
  if (next==='resolved') throw new Error('Resolution requires a Citizen-visible message. Open full details to resolve.');
  if (!next) throw new Error('This incident has no next workflow step.');
  const {error}=await requireSupabase().rpc('nigraan_update_incident_status',{
    incident:incident.id,expected_status:incident.status,next_status:next,
  });
  if (error) throw error;
}
