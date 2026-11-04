import pg from 'pg'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
// Explicit opt-in: creates and drops a random database in a loopback PostgreSQL.
// Run after a normal build: KIT_TEST_PG_ADMIN_URL=... node tooling/db-build-runtime-check.mjs
// Requires Playwright Chromium. No existing database is ever used as target.
const adminUrl=process.env.KIT_TEST_PG_ADMIN_URL
if (!adminUrl) throw new Error('KIT_TEST_PG_ADMIN_URL is required')
const parsed=new URL(adminUrl)
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname) || parsed.search || parsed.pathname !== '/postgres') throw new Error('only a loopback maintenance database without query parameters is permitted')
const dbName=`kit_build_${randomBytes(8).toString('hex')}`
parsed.pathname=`/${dbName}`
const targetUrl=parsed.toString()
const admin = new pg.Client({ connectionString:adminUrl }); await admin.connect()
let server,browser,created=false
const root=process.cwd()
const runtime=await mkdtemp(join(tmpdir(),'kit-runtime-build-'))
await mkdir(join(runtime,'tooling'))
await cp(join(root,'build'),join(runtime,'build'),{recursive:true})
await cp(join(root,'server.mjs'),join(runtime,'server.mjs'))
await cp(join(root,'package.json'),join(runtime,'package.json'))
await cp(join(root,'tooling/node-request-bridge.mjs'),join(runtime,'tooling/node-request-bridge.mjs'))
await cp(join(root,'tooling/trusted-proxy-address.mjs'),join(runtime,'tooling/trusted-proxy-address.mjs'))
await symlink(join(root,'node_modules'),join(runtime,'node_modules'))
const probeServer=createServer();await new Promise(r=>probeServer.listen(0,'127.0.0.1',r));const port=probeServer.address().port;await new Promise(r=>probeServer.close(r))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const env={...process.env,DATABASE_URL:targetUrl,AUTH_SEAL_SECRET:'test-auth-seal-secret-32-bytes-minimum-ok-01',DB_CURSOR_SECRET:'test-db-cursor-secret-32-bytes-minimum-ok-01', ADMIN_SEED:Buffer.alloc(32,4).toString('base64url'),PORT:String(port),HOST:'127.0.0.1'}
delete env.HYPERDRIVE_CONNECTION_STRING; delete env.DATABASE_DIR; delete env.MODULES; delete env.VERCEL
const base=`http://127.0.0.1:${port}`
async function waitHttp(){for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error(`runtime exited ${server.exitCode}`);try{const r=await fetch(`${base}/user/auth?stage=register`,{signal:AbortSignal.timeout(1500)});if(r.status<500)return r.status}catch{};await sleep(200)}throw new Error('runtime not ready')}
async function register(suffix){
 const ctx=await browser.newContext({javaScriptEnabled:false});const page=await ctx.newPage()
 try { await page.goto(`${base}/user/auth?stage=register`); const [r]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.locator('#user-auth').getByRole('button',{name:'Создать аккаунт'}).click()]); assert.equal(r.status(),303,`first registration POST ${suffix}`); await page.waitForURL(/stage=(auth\.)?profile/); await page.locator('input[name=nickname]').fill(`build-${suffix}`); const [p]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.locator('#user-profile').getByRole('button',{name:'Сохранить'}).click()]); assert.equal(p.status(),303,`profile ${suffix}`); }
 finally {await ctx.close()}
}
async function runBuild(n){return await new Promise((resolve,reject)=>{const log=createWriteStream(`/tmp/kit-real-build-${n}.log`);const p=spawn('npm',['run','build'],{cwd:root,env:{...env,DATABASE_RESET:'1'},stdio:['ignore','pipe','pipe']});p.stdout.pipe(log);p.stderr.pipe(log);p.on('error',reject);p.on('exit',code=>{log.end();code===0?resolve():reject(new Error(`build ${n} failed ${code}`))})})}
try{
 await admin.query(`CREATE DATABASE "${dbName}"`);created=true
 let client=new pg.Client({connectionString:targetUrl});await client.connect(); await client.query('CREATE SCHEMA other; CREATE TABLE other.keep(id int); INSERT INTO other.keep VALUES(7)'); const oid=(await client.query("SELECT oid FROM pg_namespace WHERE nspname='public'")).rows[0].oid;await client.end()
 const log=createWriteStream('/tmp/kit-runtime-build-test.log');server=spawn(process.execPath,['server.mjs'],{cwd:runtime,env,stdio:['ignore','pipe','pipe']});server.stdout.pipe(log);server.stderr.pipe(log)
 await waitHttp();browser=await chromium.launch({headless:true});await register('before')
 for(let n=1;n<=2;n++){
   client=new pg.Client({connectionString:targetUrl});await client.connect();await client.query(`CREATE TABLE public.test_marker_${n}(id int); INSERT INTO public.test_marker_${n} VALUES(1)`);await client.end()
   await runBuild(n)
   client=new pg.Client({connectionString:targetUrl});await client.connect();assert.equal((await client.query(`SELECT to_regclass('public.test_marker_${n}') AS x`)).rows[0].x,null); assert.equal((await client.query("SELECT oid FROM pg_namespace WHERE nspname='public'")).rows[0].oid,oid);assert.equal((await client.query('SELECT id FROM other.keep')).rows[0].id,7); await client.end()
   const status=await waitHttp(); await register(`after${n}`)
   client=new pg.Client({connectionString:targetUrl});await client.connect(); const rows=(await client.query("SELECT count(*)::int n FROM public.user_auth WHERE deleted_at IS NULL AND 'admin'=ANY(permissions)")).rows[0].n;assert.equal(rows,1);await client.end()
   console.log(`build ${n}: full reset, schema preserved, old runtime HTTP ${status}, register/profile write, one admin: PASS`)
 }
}finally{await browser?.close().catch(()=>{});if(server){server.kill('SIGTERM'); await Promise.race([new Promise(r=>server.once('exit',r)),sleep(6000)]);if(server.exitCode===null)server.kill('SIGKILL')} if(created)await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);await admin.end();await rm(runtime,{recursive:true,force:true})}
