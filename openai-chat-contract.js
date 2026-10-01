import catalog from './src/config/openai-text-models.js';
export const OPENAI_MODEL_OPTIONS = catalog.models;
export const DEFAULT_OPENAI_MODEL = 'gpt-6.1-sol';
export const OPENAI_TEXT_MODELS = catalog.models.map(model => model.id);
export function fallbackModels(selected = DEFAULT_OPENAI_MODEL) {
 const index = OPENAI_TEXT_MODELS.indexOf(selected);
 if (index < 0) throw Object.assign(new Error('Unknown OpenAI model'), { terminal: true, status: 400 });
 return OPENAI_TEXT_MODELS.slice(index);
}

export function chatOptions(model, legacy = { temperature: 0.3, max_tokens: 8192 }) {
 return /^gpt-(?:6|5\.6)(?:[.-]|$)/.test(model) ? { max_completion_tokens: 32768 } : legacy;
}
export function completedText(data) {
 const choice = data?.choices?.[0];
 if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw Object.assign(new Error('OpenAI response refused or filtered'), { terminal: true });
 if (choice?.finish_reason === 'length') throw Object.assign(new Error('OpenAI incomplete response (length): output budget exhausted'), { terminal: true });
 const text = choice?.message?.content;
 if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) throw new Error(`OpenAI incomplete response (${choice?.finish_reason || 'empty'})`);
 return text;
}
export function terminalOpenAIError(error) {
 const code = error?.code || error?.error?.code;
 return error?.terminal || [401,403].includes(error?.status) || ['insufficient_quota','billing_hard_limit_reached','invalid_api_key','content_policy_violation'].includes(code);
}
