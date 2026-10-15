import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingAccessMs} from '../src/utils/judgeAccess.js';
import {hasOperationsAccess} from '../src/utils/workspaceAccess.js';
const access={permanent:false,allowed:true,status:'active',server_now:'2026-10-12T00:00:00Z',expires_at:'2026-10-12T01:00:00Z',receivedAt:100};
test('countdown uses server duration and monotonic elapsed time',()=>{
 assert.equal(remainingAccessMs(access,100),3600000);assert.equal(remainingAccessMs(access,1100),3599000);
 assert.equal(remainingAccessMs(access,3600100),0);assert.equal(remainingAccessMs(access,3601100),0);
});
test('pending, rejected, revoked and expired never have remaining access',()=>{
 for(const status of ['pending','approved','rejected','revoked','expired'])assert.equal(remainingAccessMs({...access,status},100),0);
 assert.equal(remainingAccessMs({...access,allowed:false},100),0);
});
test('invalid deadline fails closed and permanent access is not timed',()=>{
 assert.equal(remainingAccessMs({...access,expires_at:'bad'},100),0);
 assert.equal(remainingAccessMs({...access,permanent:true},3600100),null);
});
test('temporary grant does not require or forge permanent approval',()=>{
 const allowed={...access,receivedAt:performance.now()};
 assert.equal(hasOperationsAccess({profile:{},operations:{verification_status:'pending'},access:allowed}),true);
 assert.equal(hasOperationsAccess({profile:{},operations:{verification_status:'active'},access:{...allowed,allowed:false}}),false);
});
test('stale active frontend capability cannot retain Operations after its deadline',()=>{
 const stale={...access,receivedAt:performance.now()-3600001};
 assert.equal(remainingAccessMs(stale),0);
 assert.equal(hasOperationsAccess({profile:{},operations:{verification_status:'pending'},access:stale}),false);
 assert.equal(hasOperationsAccess({profile:{},access:{...stale,permanent:true,allowed:true}}),true);
});
