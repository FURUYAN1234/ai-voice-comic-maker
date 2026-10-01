import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENAI_TEXT_MODELS, OPENAI_MODEL_OPTIONS, DEFAULT_OPENAI_MODEL, fallbackModels, chatOptions, completedText, terminalOpenAIError } from '../openai-chat-contract.js';
test('Sol first and compatible request with unchanged legacy options',()=>{
 assert.equal(OPENAI_TEXT_MODELS.length,11);
 assert.equal(OPENAI_TEXT_MODELS[0],'gpt-6-astra');
 assert.equal(DEFAULT_OPENAI_MODEL,'gpt-6.1-sol');
 assert.equal(fallbackModels()[0],DEFAULT_OPENAI_MODEL);
 assert.equal(OPENAI_MODEL_OPTIONS.length,11);
 for(const model of OPENAI_TEXT_MODELS.filter(id=>/^gpt-(6|5\.6)/.test(id))) assert.deepEqual(chatOptions(model),{max_completion_tokens:32768});
 assert.deepEqual(chatOptions('gpt-6.1-sol'),{max_completion_tokens:32768});
 assert.deepEqual(chatOptions('gpt-4.1',{temperature:0.1}),{temperature:0.1});
});
test('complete response accepted; length, empty and refusal fail closed',()=>{
 const data=(finish_reason,content,refusal)=>({choices:[{finish_reason,message:{content,refusal}}]});
 assert.equal(completedText(data('stop','valid')),'valid');
 assert.throws(()=>completedText(data('length','partial')),error=>terminalOpenAIError(error));
 for(const reason of ['tool_calls',undefined]) assert.throws(()=>completedText(data(reason,'partial')));
 for(const content of ['', ' ',null]) assert.throws(()=>completedText(data('stop',content)));
 assert.throws(()=>completedText(data('stop','text','refused')),error=>terminalOpenAIError(error));
 assert.throws(()=>completedText(data('content_filter','')),error=>terminalOpenAIError(error));
});
test('terminal account/policy errors stop; temporary/model errors permit fallback',()=>{
 for(const status of [401,403]) assert.ok(terminalOpenAIError({status}));
 for(const code of ['insufficient_quota','billing_hard_limit_reached','invalid_api_key','content_policy_violation']) assert.ok(terminalOpenAIError({code,status:429}));
 for(const status of [404,429,500]) assert.ok(!terminalOpenAIError({status,code:'model_not_found'}));
});

test('Vision caller stops after truncated completion without downgrade', async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const start=source.indexOf('        for (const modelName of modelsToAttempt) {',source.indexOf("app.post('/api/analyze/"));
 const end=source.indexOf("      } else {",start);
 const body=source.slice(start,end);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const calls=[];
 const run=new AsyncFunction('modelsToAttempt','openai','completedText','terminalOpenAIError','chatOptions','sessionLog','AI_TIMEOUTS',
  'let sessionId="test",prompt="sample",dataUrl="data:image/png;base64,fixture",responseText,runtimeModel="gpt-4o",success=false,lastError,selectedOpenAIModel="gpt-6.1-sol",modelStatus={attempted:[]};'+body);
 await assert.rejects(()=>run(fallbackModels(),{chat:{completions:{create:async request=>{
  calls.push(request.model);return {choices:[{finish_reason:'length',message:{content:'partial'}}]};
 }}}},completedText,terminalOpenAIError,chatOptions,()=>{}, {vision:120000}),/length/);
 assert.deepEqual(calls,['gpt-6.1-sol']);
});

test('selection strictly limits fallback to lower models and rejects unknown IDs',()=>{
 for(const model of OPENAI_TEXT_MODELS) assert.deepEqual(fallbackModels(model),OPENAI_TEXT_MODELS.slice(OPENAI_TEXT_MODELS.indexOf(model)));
 for(const invalid of ['unknown','',null,{},'gpt-image-2.5-sunburst']) assert.throws(()=>fallbackModels(invalid));
 assert.deepEqual(fallbackModels('gpt-4o'),['gpt-4o']);
});

test('analyze request boundary rejects unknown model before a provider call',async()=>{
 const {readFileSync}=await import('node:fs'); const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
 const start=source.indexOf('  const selectedOpenAIModel = req.body?.openaiModel',source.indexOf("app.post('/api/analyze/"));
 const end=source.indexOf('  const modelStatus =',start);
 const run=new Function('req','res','runtimeEngine','fallbackModels','DEFAULT_OPENAI_MODEL',source.slice(start,end)+'return selectedOpenAIModel;');
 let status;let payload; const res={status:code=>{status=code;return res;},json:data=>{payload=data;return data;}};
 run({body:{openaiModel:'unknown'}},res,'openai',fallbackModels,DEFAULT_OPENAI_MODEL);
 assert.equal(status,400);assert.equal(payload.code,'INVALID_OPENAI_MODEL');
 assert.equal(run({body:{openaiModel:'gpt-4o'}},res,'openai',fallbackModels,DEFAULT_OPENAI_MODEL),'gpt-4o');
 assert.equal(run({body:{}},res,'openai',fallbackModels,DEFAULT_OPENAI_MODEL),'gpt-6.1-sol');
});
