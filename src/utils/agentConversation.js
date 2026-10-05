import {AGENT_VIEWS,AgentError} from '../services/agentTools.js';
export const AGENT_PROMPTS=['What needs attention right now?','Give me a city status briefing.','Show me recent Citizen activity.','What are the current city conditions?','Which unresolved incidents should I review?'];
/** Deterministic English intent routing. No LLM, provider call or hidden writes. */
export function planAgentMessage(message,tools){
  if(typeof message!=='string'||!message.trim()||[...message].length>600)throw new AgentError('input','Enter a request up to 600 characters.');
  const text=message.trim().toLowerCase();
  if(/\b(?:increase|decrease|raise|lower|escalate|downgrade|set|change|update|adjust)\b.*\b(?:priority|status|critical|resolved)\b|\b(?:send|contact)\b.*\b(?:email|alert|notification|emergency services)\b/.test(text))return {message:'Operational actions require a later human-confirmed action capability. This agent can read facts and navigate only.'};
  if(/\b(?:dispatch|delete|assign|resolve|notify|send notifications|contact emergency|change (?:the )?(?:priority|status)|set (?:the )?priority|mark .*(?:resolved|assigned|acknowledged)|edit (?:the )?report)\b/.test(text))return {message:'Operational actions require a later human-confirmed action capability. This agent can read facts and navigate only.'};
  const alias=message.match(/\bI\d+\b/i)?.[0].toUpperCase();
  const ordinal=text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|last)\b/);
  const getRef=()=>alias||tools.resolveOrdinal(['first','second','third','fourth','fifth','sixth','seventh','eighth'].indexOf(ordinal?.[1]));
  if(ordinal?.[1]==='last')return {message:'Use an explicit current reference such as I1, or first through eighth.'};
  if(alias||ordinal){const ref=getRef();return {tool:/\b(?:open|navigate|view)\b/.test(text)?'navigate_to_incident':/\b(?:activity|updates|edits)\b/.test(text)?'get_incident_activity':'get_incident_details',input:{ref}};}
  for(const view of Object.keys(AGENT_VIEWS))if(/^(?:open|go to|navigate to|show me)\b/.test(text)&&text.replace(/[.!?]$/,'').endsWith(view.toLowerCase()))return {tool:'navigate_to_view',input:{view}};
  if(/\b(?:weather|conditions|rainfall|aqi|air quality)\b/.test(text))return {tool:'get_city_conditions',input:{}};
  if(/\b(?:citizen activity|citizen updates|recent activity|recent updates)\b/.test(text))return {tool:'get_incident_activity',input:{}};
  if(/\b(?:attention|urgent|unresolved incidents|review)\b/.test(text))return {tool:'get_urgent_incidents',input:{}};
  if(/\b(?:status|briefing|summary)\b/.test(text))return {tool:'get_city_status',input:{}};
  return {message:'Try a suggested read request, ask about a current I-reference, or open an Operations view. This milestone uses supported text intents, not a general AI chatbot.'};
}
export const boundedThread=(thread,entry)=>[...thread,entry].slice(-20);
