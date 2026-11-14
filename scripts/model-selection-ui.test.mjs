import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {modelStatusFromLogs} from '../src/model-status.js';
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
function exerciseHandlers(text){
 const handlers=text.slice(text.indexOf('  const handleDrop ='),text.indexOf('  // ── 動画生成開始'));
 const cached=[];let cursor=0;const calls=[];
 const render=model=>{cursor=0;const env={useCallback:fn=>{const i=cursor++;return cached[i]||(cached[i]=fn);},setDragOver:()=>{},setError:()=>{},startGeneration:file=>calls.push([model,file.name])};return new Function('env',`with(env){${handlers};return {handleDrop,handleFileSelect};}`)(env);};
 render('gpt-6.1-sol');const latest=render('gpt-6-luna');
 latest.handleFileSelect({target:{files:[{name:'known.png'}]}});
 latest.handleDrop({preventDefault(){},dataTransfer:{files:[{name:'known.png'}]}});
 return calls;
}
test('file chooser and drop use latest render model, with regression reproducing old stale closure',()=>{
 const baseline=execFileSync('git',['show','4297857b0b2127a4f3066c73201889bacc7b71c9:src/App.jsx'],{encoding:'utf8'});
 assert.deepEqual(exerciseHandlers(baseline).map(x=>x[0]),['gpt-6.1-sol','gpt-6.1-sol'],'old empty-dependency callbacks reproduce observed fault');
 assert.deepEqual(exerciseHandlers(source).map(x=>x[0]),['gpt-6-luna','gpt-6-luna']);
});
test('actual attempted/adopted state comes from explicit route events during pending response',()=>{
 let state=modelStatusFromLogs(null,['[Model] Selected: gpt-6-luna / Tried: gpt-6-luna']);
 assert.equal(state.selected,'gpt-6-luna');assert.deepEqual(state.attempted,['gpt-6-luna']);assert.equal(state.adopted,null);
 state=modelStatusFromLogs(state,['[Model] Adopted: gpt-6-luna','[OpenAI 2-Pass Correction] Requesting model: gpt-6-luna']);
 assert.equal(state.adopted,'gpt-6-luna');assert.deepEqual(state.correctionAttempted,['gpt-6-luna']);assert.equal(state.correctionAdopted,null,'request is not adoption');
});
test('existing lower-model fallback events remain accurate, unrelated logs cannot fabricate success',()=>{
 const state=modelStatusFromLogs(null,['irrelevant success','[Model] Selected: gpt-6-luna / Tried: gpt-6-luna → gpt-5.6-luna','[Model] Adopted: gpt-5.6-luna']);
 assert.deepEqual(state.attempted,['gpt-6-luna','gpt-5.6-luna']);assert.equal(state.adopted,'gpt-5.6-luna');
 assert.equal(modelStatusFromLogs(null,['OpenAI リクエスト送信中','success']),null);
});

test('ordinary setup/work/progress/stopped views contain only the upper-right emergency control',async t=>{
 const React=(await import('react')).default;const {createServer}=await import('vite');
 const server=await createServer({appType:'custom',logLevel:'silent',server:{middlewareMode:true,hmr:false}});
 try {
  const {default:App}=await server.ssrLoadModule('/src/App.jsx');
  let phase='setup',index=0;
  const internals=React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const old=internals.H;
  internals.H={useState:initial=>[index++===0?phase:initial,()=>{}],useEffect:()=>{},useRef:value=>({current:value})};
  t.after(()=>{internals.H=old;});
  const walk=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)];
  for(phase of ['setup','drop','generating','cancelling','complete']){
   index=0;const nodes=walk(App());const buttons=nodes.filter(n=>n.type==='button'&&String(n.props.className).split(' ').includes('btn-emergency-stop'));
   assert.equal(buttons.length,phase==='setup'?0:1,phase+' emergency control count');
   if(buttons.length){assert.equal(buttons[0].props.id,'emergency-stop');assert.equal(buttons[0].props.disabled,phase!=='generating');}
  }
 } finally {await server.close();}
});
