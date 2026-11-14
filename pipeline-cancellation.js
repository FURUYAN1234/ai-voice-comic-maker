import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';

export function sessionSignal(session) {
  session.abortController ||= new AbortController();
  return session.abortController.signal;
}
export function cancelSession(session) {
  session.cancelled = true;
  session.abortController ||= new AbortController();
  session.abortController.abort(Object.assign(new Error('CanceledByUser'), { name:'AbortError', terminal:true }));
}
export function throwIfSessionCancelled(session) {
  if (session.cancelled || sessionSignal(session).aborted) {
    throw sessionSignal(session).reason || Object.assign(new Error('CanceledByUser'), { name:'AbortError', terminal:true });
  }
}
export async function runCancellableAi(session, request, timeoutMs) {
  throwIfSessionCancelled(session);
  const controller = new AbortController();
  const outer = sessionSignal(session);
  const abort = () => controller.abort(outer.reason);
  outer.addEventListener('abort',abort,{once:true});
  let timer, rejectOnAbort;
  const cancelled = new Promise((_,reject)=> {
    rejectOnAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort',rejectOnAbort,{once:true});
  });
  if (timeoutMs) timer = setTimeout(()=>controller.abort(new Error('AI request timed out')),timeoutMs);
  try {
    const result = await Promise.race([Promise.resolve().then(()=>{throwIfSessionCancelled(session);return request(controller.signal);}),cancelled]);
    throwIfSessionCancelled(session);
    return result;
  } catch(error) {
    throwIfSessionCancelled(session);
    throw error;
  } finally {
    clearTimeout(timer);outer.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectOnAbort);
  }
}
export function callOpenAI(session, client, body, options = {}) {
  return runCancellableAi(session, signal => client.chat.completions.create(body, {...options,signal,maxRetries:0}), options.timeout);
}
export function runCancellableProcess(session,filename,args,options={}) {
  throwIfSessionCancelled(session);
  return new Promise((resolve,reject)=>{
    let failure,stdout='',stderr='';
    const child=execFile(filename,args,{...options,signal:sessionSignal(session),windowsHide:true},(error,out,err)=>{
      failure ||= error;stdout=out;stderr=err;
    });
    child.on('error',error=>{failure ||= error;});
    // AbortError can arrive before exit. Keep the lock/files until the child closes.
    child.once('close',()=>{
      try {throwIfSessionCancelled(session);if(failure)throw failure;resolve({stdout,stderr});}
      catch(error){reject(error);}
    });
  });
}
export function bindRequestCancellation(req,res,session) {
  sessionSignal(session);
  const abort = () => cancelSession(session);
  const close = () => { if (!res.writableEnded) abort(); };
  req.once('aborted',abort);res.once('close',close);
  if(req.aborted || res.destroyed)abort();
  let finish;
  session.operationDone = new Promise(resolve=>{finish=resolve;});
  return () => {req.removeListener('aborted',abort);res.removeListener('close',close);finish();session.operationDone=null;};
}
export function acquireOwnedLock(filename,owner) {
  const token = `${owner}:${randomUUID()}`;
  try {fs.writeFileSync(filename,token,{encoding:'utf8',flag:'wx'});return token;}
  catch(error) {if(error.code==='EEXIST')return null;throw error;}
}
export function releaseOwnedLock(filename,token) {
  if(!token)return false;
  try {if(fs.readFileSync(filename,'utf8')!==token)return false;fs.unlinkSync(filename);return true;}
  catch(error) {if(error.code==='ENOENT')return false;throw error;}
}
