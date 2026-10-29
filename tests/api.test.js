const {test}=require('node:test');
const assert=require('node:assert/strict');
const https=require('node:https');
const {EventEmitter}=require('node:events');
Object.assign(process.env,{ALLOWED_ORIGIN:'https://example.com',SEATABLE_API_TOKEN:'test-secret',SEATABLE_BASE_UUID:'test-base',SEATABLE_TABLE_NAME:'信息登记'});
let calls=[];
https.request=(url,options,callback)=>{
 const req=new EventEmitter(); req.end=data=>{calls.push({url:String(url),options,data});queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.setEncoding=()=>{};callback(res);const result=String(url).includes('app-access-token')?{access_token:'temporary',dtable_uuid:'test-base'}:options.method==='POST'?{success:true}: {rows:[{'姓名':'<script>','电话':'123','秘密':'不应返回'}]};res.emit('data',JSON.stringify(result));res.emit('end');req.emit('close')})};req.destroy=error=>{req.emit('error',error);req.emit('close')};return req;
};
const {main}=require('../lib/data-service');
const invoke=body=>main({httpMethod:'POST',headers:{origin:'https://example.com'},body:JSON.stringify(body)});
test('拒绝修改、删除、未知动作及透传参数，且不调用上游',async()=>{for(const action of ['update','delete','sql','append']){const result=await invoke({action});assert.equal(result.statusCode,403);if(['update','delete'].includes(action))assert.equal(JSON.parse(result.body).message,'不允许修改和删除数据')}assert.equal((await invoke({action:'list',url:'https://evil.test'})).statusCode,400);assert.equal(calls.length,0)});
test('校验必填、未知字段和长度',async()=>{for(const data of [{name:' ',phone:'1'},{name:'a',phone:'1',_id:'x'},{name:'a'.repeat(81),phone:'1'},null])assert.equal((await invoke({action:'add',data})).statusCode,400);assert.equal(calls.length,0)});
test('只投影可见字段，使用网关和临时凭证',async()=>{const result=JSON.parse((await invoke({action:'list'})).body);assert.deepEqual(result.rows,[{name:'<script>',phone:'123'}]);assert.match(calls[1].url,/api-gateway/);assert.equal(calls[1].options.headers.Authorization,'Bearer temporary');assert.ok(!JSON.stringify(result).includes('test-secret'))});
test('新增仅发送一行且裁剪空格',async()=>{assert.equal((await invoke({action:'add',data:{name:' 张三 ',phone:'123'}})).statusCode,200);assert.deepEqual(JSON.parse(calls.at(-1).data),{table_name:'信息登记',rows:[{'姓名':'张三','电话':'123'}]})});
test('HTTP 方法、跨域、损坏 JSON 拦截',async()=>{assert.equal((await main({httpMethod:'GET'})).statusCode,405);assert.equal((await main({httpMethod:'POST',headers:{origin:'https://evil.test'}})).statusCode,403);assert.equal((await main({httpMethod:'POST',body:'{'})).statusCode,400);assert.equal((await main({httpMethod:'OPTIONS',headers:{origin:'https://example.com'}})).statusCode,204)});
test('Vercel 适配器接受同域并拦截其他来源',async()=>{
 process.env.VERCEL_URL='test.vercel.app';
 const handler=require('../api/data');
 async function run(origin,body){const res={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(value){this.value=value;return this},send(value){this.value=value;return this}};await handler({method:'POST',headers:{origin},body},res);return res}
 const accepted=await run('https://test.vercel.app',{action:'list'});assert.equal(accepted.code,200);assert.equal(JSON.parse(accepted.value).ok,true);
 const denied=await run('https://evil.test',{action:'add'});assert.equal(denied.code,403);
 const update=await run('https://test.vercel.app',{action:'update'});assert.equal(update.code,403);assert.equal(JSON.parse(update.value).message,'不允许修改和删除数据');
});
