import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GoogleGenerativeAI} from '@google/generative-ai';

test('server Gemini model configurations serialize without deprecated sampling fields',async()=>{
  const source=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const configs=[...source.matchAll(/genAI\.getGenerativeModel\((\{[\s\S]*?\})\);/g)].map(match=>new Function('modelName',`return (${match[1]});`)('gemini-3.8-flash'));
  assert.ok(configs.filter(config=>config.generationConfig?.responseMimeType==='application/json').length>=2,'OCR and correction configs must be included');
  const saved=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push(JSON.parse(init.body));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));};
  try {
    for(const config of configs) await new GoogleGenerativeAI('test-only').getGenerativeModel(config).generateContent('contract');
    assert.equal(calls.length,configs.length);
    for(const body of calls)for(const field of ['temperature','topP','topK','thinkingBudget'])assert.equal(Object.hasOwn(body.generationConfig||{},field),false,field);
  } finally {globalThis.fetch=saved;}
});
