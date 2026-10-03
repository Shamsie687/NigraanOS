import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {renderToString} from 'react-dom/server';
import React from 'react';
import {emptyTranscript} from '../src/utils/transcriptState.js';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {default:VoiceTranscript}=await server.ssrLoadModule('/src/components/VoiceTranscript.jsx');
  const {default:EvidenceTranscript}=await server.ssrLoadModule('/src/components/EvidenceTranscript.jsx');
  const render=state=>renderToString(React.createElement(VoiceTranscript,{state}));
  assert.match(render(emptyTranscript()),/Transcribe recording/);
  assert.match(render({...emptyTranscript(),status:'loading'}),/Processing audio/);
  assert.match(render({...emptyTranscript(),status:'failed',error:'Service unavailable'}),/Retry transcription/);
  assert.match(render({...emptyTranscript(),status:'skipped'}),/Audio will be kept without a transcript/);
  const text='یہاں مدد چاہیے۔';
  assert.match(render({...emptyTranscript(),status:'ready',jobId:'test',text,reviewed:true}),/dir="auto"/);
  assert.ok(render({...emptyTranscript(),status:'ready',jobId:'test',text,reviewed:true}).includes(text));
  const evidence=file=>renderToString(React.createElement(EvidenceTranscript,{file}));
  assert.match(evidence({transcript:text,transcription_status:'ready'}),/Machine transcript/);
  assert.match(evidence({transcript:text,machine_transcript:'original',transcription_status:'confirmed'}),/Citizen-reviewed transcript/);
  assert.match(evidence({transcription_status:'failed'}),/original audio retained/);
  assert.match(evidence({}),/No transcript available/);
  assert.ok(!evidence({transcript:text}).includes('verified evidence'));
  console.log('Transcription loading/failure/retry/edit/review/skip and Operations transcript render checks passed.');
} finally {await server.close();}
