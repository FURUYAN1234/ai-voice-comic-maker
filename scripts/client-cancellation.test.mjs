import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const start=source.indexOf('  const startGeneration = async');
const end=source.indexOf('  // ── 生成中断',start);
const generation=source.slice(start,end);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

for(const stage of ['upload','ocr-error','result'])test(`ordinary UI ignores late ${stage} after stop and accepts an explicit new run`,async()=>{
 const values={},calls=[];let release;
 const env={abortControllerRef:{current:null},sessionIdRef:{current:null},ttsEngineRef:{current:'auto'},openaiModel:'gpt-6-luna',PHASE:{GENERATING:'generating',DROP:'drop',COMPLETE:'complete'},getTtsEngineLabel:()=> 'auto'};
 for(const field of ['Phase','Error','OcrPreview','TerminalLogs','CurrentSessionId','VideoTitle','Progress','ModelStatus','VideoUrl','VideoFilename'])env['set'+field]=value=>{values[field]=value;};
 let suspended=true;
 env.localApiFetch=async url=>{
   calls.push(url);
   if(url==='/api/upload')return suspended&&stage==='upload'?new Promise(resolve=>release=()=>resolve({ok:true,json:async()=>({sessionId:'old'})})):{ok:true,json:async()=>({sessionId:'fresh'})};
   if(url.includes('/api/analyze/'))return suspended&&stage==='ocr-error'?{ok:false,json:()=>new Promise(resolve=>release=()=>resolve({error:'old failure',modelStatus:{adopted:'old model'}}))}:{ok:true,json:async()=>({metadata:{title:'normal'},modelStatus:{adopted:'gpt-6-luna'}})};
   return {ok:true,json:()=>suspended&&stage==='result'?new Promise(resolve=>release=()=>resolve({videoFilename:'late.mp4'})):Promise.resolve({videoFilename:'normal.mp4'})};
 };
 const run=new Function('env',`with(env){${generation};return startGeneration;}`)(env);
 const image=Object.assign(new Blob(['fixture'],{type:'image/png'}),{name:'fixture.png'});
 const pending=run(image);while(!release)await turn();
 env.abortControllerRef.current.abort();release();await pending;
 assert.notEqual(values.Phase,'complete');assert.equal(values.VideoUrl,undefined);assert.equal(env.abortControllerRef.current,null);
 if(stage==='upload')assert.deepEqual(calls,['/api/upload']);
 if(stage==='ocr-error')assert.equal(values.ModelStatus,undefined,'a late old error body cannot replace model state');
 suspended=false;await run(image);
 assert.equal(values.Phase,'complete');assert.equal(values.VideoFilename,'normal.mp4');assert.equal(values.VideoUrl,'/api/video/fresh');
});

test('failed cancellation acknowledgement keeps restart locked and offers an explicit safe retry',async()=>{
 const a=source.indexOf('  const handleCancel = async'),b=source.indexOf('  // ── ダウンロード',a);
 const controller=new AbortController(),env={phase:'generating',apiChecking:false,abortControllerRef:{current:controller},sessionIdRef:{current:'own-session'},PHASE:{CANCELLING:'cancelling',DROP:'drop'}};
 let requests=0,fail=true;
 env.setPhase=value=>{env.phase=value;};env.setError=value=>{env.error=value;};env.setProgress=()=>{};
 env.localApiFetch=async()=>{requests++;return {ok:!fail};};
 const cancel=new Function('env',`with(env){${source.slice(a,b)};return handleCancel;}`)(env);
 await cancel();assert.equal(controller.signal.aborted,true);assert.equal(env.phase,'cancelling');assert.match(env.error,/中断の確認に失敗/);
 env.abortControllerRef.current=null;fail=false;await cancel();assert.equal(env.phase,'drop');assert.equal(env.error,null);assert.equal(requests,2);
 await cancel();assert.equal(requests,2,'idle cannot start cancellation or AI work');
});
