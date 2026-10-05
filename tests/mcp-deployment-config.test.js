import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpDeploymentConfig} from '../src/services/mcpDeploymentConfig.js';
test('MCP local defaults remain exact and deployment uses explicit HTTPS origin/callback',()=>{
  assert.deepEqual(mcpDeploymentConfig('http://127.0.0.1:8787'),{endpoint:'http://127.0.0.1:8787',redirect:'http://127.0.0.1:8788/callback'});
  assert.equal(mcpDeploymentConfig('https://api.example','https://client.example/callback').redirect,'https://client.example/callback');
  for(const [a,b] of [['https://api.example',''],['http://api.example','https://client.example/callback'],['https://api.example/path','https://client.example/callback'],['https://api.example','https://client.example/callback?other=value'],['https://api.example','http://client.example/callback']]) assert.throws(()=>mcpDeploymentConfig(a,b));
});
