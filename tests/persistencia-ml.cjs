// Requiere PostgreSQL de pruebas vacío; nunca lee .env ni permite un host remoto.
// SCCA_TEST_PORT y SCCA_TEST_DATABASE designan exclusivamente la instancia temporal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {Client} = require('pg');
const root = path.resolve(__dirname, '..');
const database = process.env.SCCA_TEST_DATABASE;
const port = Number(process.env.SCCA_TEST_PORT);
if (!database?.startsWith('scca_test_') || !Number.isInteger(port) || port < 1024) throw Error('Configura una base temporal scca_test_* y su puerto.');
const client = new Client({host:'127.0.0.1', port, database, user:'scca_test'});
const version = 'b'.repeat(32);
const secret = 'solo-prueba-local-no-productivo';
let api, mock;
let changedMetadata = false;
let rejectedModel = false;
let receivedValues;
let checks = 0;
async function request(body, expected=200) {
 const r=await fetch('http://127.0.0.1:15053/api/modelo/evaluar', {method:'POST',headers:{'Content-Type':'application/json','X-Api-Key':secret},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const output=await r.json();assert.equal(r.status,expected);return output;
}
async function count(table){return Number((await client.query('SELECT count(*) AS n FROM '+table)).rows[0].n);}
(async()=>{try{
 await client.connect();
 assert.equal((await client.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,'0','Base de pruebas debe estar vacía');
 await client.query(`
 CREATE TABLE nodo(id int primary key,intervalo_muestreo_s int);
 CREATE TABLE sensor(id int primary key,nodo_id int references nodo(id),modelo text,origen text,activo boolean);
 CREATE TABLE unidad(id smallint primary key,simbolo text);
 CREATE TABLE variable(id smallint primary key,codigo text,unidad_id smallint);
 CREATE TABLE sensor_variable(sensor_id int,variable_id smallint,primary key(sensor_id,variable_id));
 CREATE TABLE lectura_original(id bigint generated always as identity primary key,sensor_id int,variable_id smallint,valor numeric,medido_en timestamptz,calidad text);
 INSERT INTO nodo VALUES(1,60);
 INSERT INTO sensor VALUES(1,1,'Python Script','simulado',true);
 INSERT INTO unidad VALUES(1,'µg/m3');
 INSERT INTO variable VALUES(1,'PM25',1),(2,'PM1',1),(3,'PM10',1),(4,'CO',1);
 INSERT INTO sensor_variable VALUES(1,1),(1,2),(1,3),(1,4);
 INSERT INTO lectura_original(sensor_id,variable_id,valor,medido_en,calidad)
 SELECT 1,1,10,'2026-01-01T00:00:00Z'::timestamptz+make_interval(mins=>n*15),'valida' FROM generate_series(0,3) n;
 `);
 const migration=fs.readFileSync(path.join(root,'db/04_resultados_ml_demo.sql'),'utf8');
 await client.query(migration);await client.query(migration);checks++;
 mock=http.createServer(async(req,res)=>{const chunks=[];for await(const x of req)chunks.push(x);const input=JSON.parse(Buffer.concat(chunks));
 const metadata={version,perfil:input.perfil,proposito:input.proposito,variable:input.variable,horizonte_h:input.horizonte_h,sha256:changedMetadata?'c'.repeat(64):'a'.repeat(64)};
 const output={...input,estado:req.url.endsWith('/estado')?'disponible_demo':'evaluado_demo',ambito:'demostracion',calibracion_fisica_validada:false,
 modelo_version:version,modelo_metadatos:metadata,variables_entrada:['PM25'],entrada_agregado_s:3600,intervalo_s:900,completitud_minima:.75,valor:null,es_anomalia:null};
 if(req.url.endsWith('/inferir')) {receivedValues=input.valores;output.valor=input.valores.PM25*2;delete output.valores;}
 if(rejectedModel)output.estado='sin_modelo';
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(output));});
 await new Promise(r=>mock.listen(18003,'127.0.0.1',r));
 api=spawn('dotnet',[path.join(root,'backend/Scca.Api/bin/comprobacion-persistencia/Scca.Api.dll')],{windowsHide:true,stdio:'ignore',env:{...process.env,
 ASPNETCORE_URLS:'http://127.0.0.1:15053',ASPNETCORE_ENVIRONMENT:'Development',ConnectionStrings__Postgres:`Host=127.0.0.1;Port=${port};Database=${database};Username=scca_test`,
 Iot__ApiKey:secret,Ml__BaseUrl:'http://127.0.0.1:18003/',Ml__PersistenciaDemoHabilitada:'true',Ml__IntervalosSensor__1:'900'}});
 let ready=false;for(let i=0;i<40;i++){try{await fetch('http://127.0.0.1:15053/swagger/index.html');ready=true;break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 const body={sensorId:1,proposito:'calibracion',variable:'PM25',horizonteH:0,horaInicio:'2026-01-01T00:00:00Z'};
 const readonly=await request(body);assert.equal(readonly.estado,'evaluado_demo');assert.equal(await count('ml_demo_resultado'),0);checks++;
 const first=await request({...body,guardarResultado:true});assert.equal(first.persistido,true);assert.equal(first.valor,20);assert.equal(receivedValues.PM25,10);checks++;
 const [second,third]=await Promise.all([request({...body,guardarResultado:true}),request({...body,guardarResultado:true})]);
 assert.equal(first.resultado_id,second.resultado_id);assert.equal(first.resultado_id,third.resultado_id);assert.equal(await count('ml_demo_resultado'),1);assert.equal(await count('ml_demo_version'),1);checks++;
 changedMetadata=true;await request({...body,guardarResultado:true},503);assert.equal(await count('ml_demo_resultado'),1);changedMetadata=false;checks++;
 await assert.rejects(client.query('UPDATE ml_demo_resultado SET entrada=entrada'));await assert.rejects(client.query('DELETE FROM ml_demo_version'));await assert.rejects(client.query('TRUNCATE ml_demo_resultado'));checks++;
 await client.query("INSERT INTO lectura_original(sensor_id,variable_id,valor,medido_en,calidad) VALUES(1,1,18,'2026-01-01T00:01:00Z','valida')");
 const late=await request({...body,guardarResultado:true});assert.notEqual(first.resultado_id,late.resultado_id);assert.equal(late.valor,22);assert.equal(await count('ml_demo_resultado'),2);checks++;
 const missing=await request({...body,horaInicio:'2026-01-02T00:00:00Z',guardarResultado:true});assert.equal(missing.estado,'datos_incompletos');assert.equal(await count('ml_demo_resultado'),2);checks++;
 rejectedModel=true;assert.equal((await request({...body,guardarResultado:true})).estado,'sin_modelo');assert.equal(await count('ml_demo_resultado'),2);checks++;
  const history=await fetch('http://127.0.0.1:15053/api/modelo/resultados?sensorId=1&limite=1',{headers:{'X-Api-Key':secret}});
 assert.equal(history.status,200);const page=await history.json();assert.equal(page.items.length,1);assert.equal(page.items[0].id,first.resultado_id);
 const next=await (await fetch('http://127.0.0.1:15053/api/modelo/resultados?sensorId=1&despuesDe='+page.siguiente_despues_de,{headers:{'X-Api-Key':secret}})).json();assert.equal(next.items.length,1);checks++;
 const other=await (await fetch('http://127.0.0.1:15053/api/modelo/resultados?sensorId=2',{headers:{'X-Api-Key':secret}})).json();assert.equal(other.items.length,0);checks++;
 assert.equal((await fetch('http://127.0.0.1:15053/api/modelo/resultados?sensorId=1')).status,401);checks++;
 assert.equal(await count('lectura_original'),5);checks++;
 console.log(`OK: ${checks} comprobaciones PostgreSQL/.NET; migración repetible, lectura sin escritura, persistencia, concurrencia, inmutabilidad y datos tardíos.`);
}finally{if(api)api.kill();if(mock){mock.closeAllConnections();mock.close();}await client.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});

