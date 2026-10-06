import test from 'node:test';
import assert from 'node:assert/strict';
import {presentInvestigation,investigationProgress,unavailableLabel} from '../src/utils/investigationPresentation.js';
import {briefingFixture} from './investigation-presentation-fixtures.js';
test('complete deterministic summary and coverage reflect bounded reads',async()=>{
 const v=presentInvestigation(await briefingFixture());assert.equal(v.summary,'2 of 3 returned candidates were inspected for human review.');assert.equal(v.status,'complete');assert.equal(v.candidates.length,2);assert.equal(v.coverage.notInspected,1);
 assert.deepEqual(v.candidates[0].reasons,['Recorded priority: High','Awaiting acknowledgement','Recent published update']);assert.equal(v.checked.length,7);
});
for(const count of [0,1,8])test(`presentation coverage for ${count} candidates`,async()=>{
 const v=presentInvestigation(await briefingFixture({count}));assert.equal(v.candidates.length,Math.min(2,count));assert.equal(v.coverage.inspected,Math.min(2,count));assert.equal(v.coverage.notInspected,count-Math.min(2,count));
});
test('partial failures render safe unavailable sections and candidate-only observation',async()=>{
 const v=presentInvestigation(await briefingFixture({fail:['get_city_status','get_incident_details:I2','get_city_conditions']}));assert.equal(v.status,'partial');assert.deepEqual(v.unavailable,['City aggregate unavailable','Details unavailable for I2','Modeled context unavailable']);assert.equal(v.candidates[1].inspected,false);assert.equal(v.modeledContext,null);
});
test('changed status/priority retain before/later provenance and current detail values',async()=>{
 const v=presentInvestigation(await briefingFixture({changed:true}));assert.equal(v.candidates[0].status,'acknowledged');assert.equal(v.candidates[0].priority,'normal');assert.deepEqual(v.candidates[0].changes.map(c=>c.field),['status','priority']);assert.ok(v.candidates[0].changes.every(c=>Date.parse(c.afterAt)>Date.parse(c.beforeAt)));assert.ok(!v.candidates[0].reasons.includes('Recorded priority: High'));
});
test('no reasons produces neutral deterministic wording and modeled context stays separate',async()=>{
 const v=presentInvestigation(await briefingFixture({noReasons:true}));assert.equal(v.reasonSummary,'No inspected incident matched the configured review-reason rules.');assert.ok(v.candidates.every(c=>!c.reasons.length));assert.ok(v.modeledContext.disclaimer.includes('does not verify incident severity or confirm flooding'));assert.ok(!v.candidates.some(c=>Object.hasOwn(c,'weather')));
});
test('progress labels use safe real stage/ref values only',()=>{
 assert.equal(investigationProgress('get_incident_details','I2'),'Inspecting I2…');assert.equal(investigationProgress('prepare_briefing'),'Preparing grounded briefing…');assert.equal(investigationProgress('PRIVATE_STAGE','PRIVATE_UUID'),'');assert.ok(!investigationProgress('get_incident_details','PRIVATE_UUID').includes('PRIVATE'));
 assert.equal(unavailableLabel('get_incident_activity:I1'),'Published activity unavailable for I1');
});
test('presentation rejects private fields rather than rendering/debug-dumping them',async()=>{
 const r=await briefingFixture();r.facts[0].title='PRIVATE_TITLE';assert.throws(()=>presentInvestigation(r));
});
