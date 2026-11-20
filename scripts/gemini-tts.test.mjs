import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiVoiceCasting, GEMINI_TTS_MODEL, synthesizeGeminiTts} from '../server/gemini-tts.mjs';
import {GEMINI_VOICES, getGeminiVoiceAssignments, validateGeminiVoiceAssignments} from '../src/gemini-voices.js';

function fixtureWav() {
  const audioLength = 48_000;
  const bytes = Buffer.alloc(44 + audioLength);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(audioLength, 40);
  return bytes;
}

test('Gemini TTS keeps a stable voice by speaker and distinguishes two characters', () => {
  const cast = createGeminiVoiceCasting();
  const first = cast({speaker:'花子', gender:'female'});
  assert.notEqual(cast({speaker:'太郎', gender:'male'}), first);
  assert.notEqual(cast({speaker:'次郎', gender:'male'}), cast({speaker:'太郎', gender:'male'}));
  assert.equal(cast({speaker:'花子', gender:'unknown'}), first);
});

test('casting exposes all 30 built-in voices and applies one choice per detected speaker', () => {
  const cast = createGeminiVoiceCasting();
  const automaticallyChosen = Array.from({length:30}, (_, index) => cast({speaker:`話者${index}`, gender:'female'}));
  assert.equal(new Set(GEMINI_VOICES).size, 30);
  assert.deepEqual(new Set(automaticallyChosen), new Set(GEMINI_VOICES));
  const first = {speaker:'花子', geminiVoiceId:'Kore'};
  const second = {speaker:'アカリ', geminiVoiceId:'Aoede'};
  const sign = {speaker:'モニター', geminiVoiceId:'Puck', textRole:'story_text'};
  const metadata = {panels:[{dialogues:[first, second, sign]},{dialogues:[first]}]};
  assert.deepEqual(getGeminiVoiceAssignments(metadata), [
    {speaker:'花子',voice:'Kore'},{speaker:'アカリ',voice:'Aoede'},
  ]);
  assert.equal(getGeminiVoiceAssignments(metadata, true).at(-1).speaker, sign.speaker);
  const overrides = validateGeminiVoiceAssignments([{speaker:'アカリ',voice:'Sadaltager'}], ['花子','アカリ']);
  assert.equal(overrides.get('アカリ'), 'Sadaltager');
  assert.throws(() => validateGeminiVoiceAssignments([{speaker:'別人',voice:'Kore'}], ['花子']), /検出された話者/);
  assert.throws(() => validateGeminiVoiceAssignments([{speaker:'花子',voice:'Unknown'}], ['花子']), /標準音声/);
});

test('the approved Gemini route separates acting directions and spoken text, and validates WAV', async t => {
  const reference = fixtureWav();
  const audio = {type:'audio', mime_type:'audio/wav', data:reference.toString('base64')};
  let response = {status:'completed', steps:[{type:'model_output', content:[audio]}]};
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, GEMINI_TTS_MODEL);
    assert.equal(payload.store, false);
    assert.equal(payload.input[0].content[0].text, 'おはよう！');
    assert.match(payload.input[0].content[0].annotations[0].style, /cheerful/);
    assert.deepEqual(payload.generation_config.speech_config, [{voice:'Kore'}]);
    return Response.json(response);
  });
  const input = {key:'fixture-key', text:'おはよう！', emotion:'happy', voice:'Kore', signal:new AbortController().signal};
  const result = await synthesizeGeminiTts(input);
  assert.deepEqual(result.bytes, reference);
  assert.equal(result.durationSec, 1);
  response = {status:'completed', steps:[{type:'model_output', content:[{...audio, data:'ZGF0YQ=='}]}]};
  await assert.rejects(synthesizeGeminiTts(input), /有効なWAV音声/);
});
