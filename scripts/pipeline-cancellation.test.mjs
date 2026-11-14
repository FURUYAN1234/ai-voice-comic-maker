import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { callOpenAI, throwIfSessionCancelled, runCancellableAi, runCancellableProcess, cancelSession, bindRequestCancellation, acquireOwnedLock, releaseOwnedLock } from '../pipeline-cancellation.js';

for (const provider of ['gemini','openai']) test(`${provider} SDK request is aborted during thought; no fallback or late adoption`,{timeout:2500},async()=>{
  const session={},original=globalThis.fetch;let calls=0,signal,release;
  const request=async(_url,init)=>{calls++;signal=init.signal;return new Promise(resolve=>{release=resolve;});};
  globalThis.fetch=request;
  const client=provider==='gemini'?new GoogleGenerativeAI('fixture-key'):new OpenAI({apiKey:'fixture-key',fetch:request,maxRetries:0});
  const sdkCall=signal=>provider==='gemini'?client.getGenerativeModel({model:'gemini-fixture'}).generateContent('fixture',{signal}):client.chat.completions.create({model:'gpt-fixture',messages:[{role:'user',content:'fixture'}]},{signal,maxRetries:0});
  const execution=(async()=>{for(const model of ['first','fallback']){try{return await runCancellableAi(session,sdkCall,1000);}catch(error){if(error.name==='AbortError')throw error;}}})();
  try {
    while(!calls)await new Promise(resolve=>setImmediate(resolve));
    cancelSession(session);await assert.rejects(execution,{name:'AbortError'});assert.equal(signal.aborted,true);
    release(new Response(JSON.stringify({candidates:[{content:{parts:[{text:'late'}]}}],choices:[{message:{content:'late'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}}));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
    await assert.rejects(runCancellableAi(session,sdkCall),{name:'AbortError'});
    assert.equal(await runCancellableAi({},async()=> 'fresh result',100),'fresh result');
  } finally {globalThis.fetch=original;}
});

test('disconnect aborts current session; finished response does not cancel accepted state',()=>{
  const req=new EventEmitter(),res=new EventEmitter(),session={};res.writableEnded=false;
  const done=bindRequestCancellation(req,res,session);res.emit('close');assert.equal(session.cancelled,true);done();
  const req2=new EventEmitter(),res2=new EventEmitter(),normal={};res2.writableEnded=true;
  const finished=bindRequestCancellation(req2,res2,normal);res2.emit('close');assert.equal(normal.cancelled,undefined);finished();
});
test('old cancellation/finally cannot release a newer pipeline owner lock',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-owned-lock-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const filename=path.join(dir,'.lock');
  const first=acquireOwnedLock(filename,'one');assert.ok(first);assert.equal(acquireOwnedLock(filename,'two'),null);
  assert.equal(releaseOwnedLock(filename,'wrong-owner'),false);assert.equal(releaseOwnedLock(filename,first),true);
  const second=acquireOwnedLock(filename,'two');assert.ok(second);assert.equal(releaseOwnedLock(filename,first),false);assert.equal(fs.existsSync(filename),true);assert.equal(releaseOwnedLock(filename,second),true);
});
test('actual route finally always settles cancellation acknowledgement even if lock release fails',()=>{
 const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
 assert.equal((source.match(/try \{ releaseLock\(lockToken\); \} finally \{ finishOperation\(\); \}/g)||[]).length,2);
 const body=source.match(/try \{ releaseLock\(lockToken\); \} finally \{ finishOperation\(\); \}/)[0];
 let finished=false;
 const cleanup=new Function('releaseLock','finishOperation','lockToken',body);
 assert.throws(()=>cleanup(()=>{throw new Error('EACCES');},()=>{finished=true;},'owner'),/EACCES/);
 assert.equal(finished,true);
});

for(const provider of ['gemini','openai'])test(`actual ${provider} Vision fallback loop terminates after user stop and rejects late output`,{timeout:2000},async()=>{
 const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const analyze=source.slice(source.indexOf("app.post('/api/analyze/"));
 const start=analyze.indexOf('        for (const modelName of modelsToAttempt) {',provider==='gemini'?analyze.indexOf('// Gemini ロジック'):0);
 const end=analyze.indexOf(provider==='gemini'?'      }\n\n      if (!success)':'      } else {',start);
 assert.ok(start>=0&&end>start);
 const session={};let calls=0,signal,release;
 const pending=signalValue=>{calls++;signal=signalValue;return new Promise(resolve=>release=resolve);};
 const openai={chat:{completions:{create:(_body,options)=>pending(options.signal)}}};
 const genAI={getGenerativeModel:()=>({generateContent:(_body,options)=>pending(options.signal)})};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('session','openai','genAI','callOpenAI','runCancellableAi','throwIfSessionCancelled',`
  const modelsToAttempt=['first','fallback'],selectedOpenAIModel='first',modelStatus={attempted:[]},sessionId='fixture',prompt='fixture',dataUrl='',mimeType='image/png',base64Image='',AI_TIMEOUTS={vision:1000};
  const sessionLog=()=>{},chatOptions=()=>({}),terminalOpenAIError=()=>false,completedText=()=> 'late';
  let responseText='',runtimeModel='',success=false,lastError;
 `+analyze.slice(start,end)+`;return {success,responseText};`);
 const result=run(session,openai,genAI,callOpenAI,runCancellableAi,throwIfSessionCancelled);
 while(!calls)await new Promise(resolve=>setImmediate(resolve));
 cancelSession(session);await assert.rejects(result,{name:'AbortError'});assert.equal(signal.aborted,true);
 release({response:{text:()=> 'late'}});await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
});

test('local synthesis/BGM subprocess cancellation waits for close, and a fresh normal process succeeds',{timeout:2500},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-process-cancel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const ready=path.join(dir,'ready');
 const session={};const waiting=runCancellableProcess(session,process.execPath,['-e',`require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);`,ready]);
 while(!fs.existsSync(ready))await new Promise(resolve=>setTimeout(resolve,5));
 const pid=Number(fs.readFileSync(ready,'utf8'));cancelSession(session);await assert.rejects(waiting,{name:'AbortError'});
 assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH','canceled child has exited before cancellation resolves');
 const normal=await runCancellableProcess({},process.execPath,['-e','console.log("normal process")']);assert.match(normal.stdout,/normal process/);
 await assert.rejects(runCancellableProcess({},process.execPath,['-e','process.exit(2)']));
});
