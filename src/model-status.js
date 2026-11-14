// Consume only explicit model-route events; never infer adoption from a request.
export function modelStatusFromLogs(previous, logs) {
  let result=previous;
  const update=patch=>{result={selected:null,attempted:[],adopted:null,correctionAttempted:[],correctionAdopted:null,...result,...patch};};
  for(const line of logs || []) {
    let m=String(line).match(/^\[Model\] Selected: (gpt-[a-z0-9.-]+) \/ Tried: (.+)$/);
    if(m){const attempted=m[2].split(' → ');if(attempted.every(id=>/^gpt-[a-z0-9.-]+$/.test(id)))update({selected:m[1],attempted});continue;}
    m=String(line).match(/^\[Model\] Adopted: (gpt-[a-z0-9.-]+)$/);
    if(m){update({adopted:m[1]});continue;}
    m=String(line).match(/^\[OpenAI 2-Pass Correction\] Requesting model: (gpt-[a-z0-9.-]+)$/);
    if(m)update({correctionAttempted:[...new Set([...(result?.correctionAttempted || []),m[1]])]});
  }
  return result;
}
