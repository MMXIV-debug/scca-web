// Integración aislada. No carga .env; solo host local y base vacía scca_test_*.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const express=require('express');
const {crearRouterCuarentena}=require('../services/cuarentenaService');
const database=process.env.SCCA_TEST_DATABASE, port=Number(process.env.SCCA_TEST_PORT);
if(!database?.startsWith('scca_test_')||!Number.isInteger(port)||port<1024)throw Error('Requiere base temporal local.');
const pool=new Pool({host:'127.0.0.1',port,database,user:'scca_test'});
let server, checks=0;
const motivo='Comprobado con instrumento de referencia.';
const auth=(req,res,next)=>{const id=Number(req.headers['x-test-user']);if(!id)return res.sendStatus(401);req.user={id,rol:id===2?'Visualizador':'Administrador'};next();};
const admin=(req,res,next)=>req.user.rol==='Administrador'?next():res.sendStatus(403);
async function req(method,url,body,user=1,status=200){const r=await fetch('http://127.0.0.1:15054/api/admin/cuarentena'+url,{method,headers:{'Content-Type':'application/json',...(user?{'X-Test-User':String(user)}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,status);checks++;return r.headers.get('content-type')?.includes('json')?r.json():null;}
const decide=(ids,accion='restaurar',user=1,status=200)=>req('POST','/decisiones',{ids,accion,motivo},user,status);
(async()=>{try{
 assert.equal((await pool.query("SELECT count(*) n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n,'0');
 await pool.query(`CREATE TABLE rol(id int primary key,nombre text);INSERT INTO rol VALUES(1,'Administrador'),(2,'Visualizador');
 CREATE TABLE usuario(id int primary key,rol_id int,activo boolean,estado text);INSERT INTO usuario VALUES(1,1,true,'aprobado'),(2,2,true,'aprobado'),(3,1,false,'inactivo');
 CREATE TABLE sensor(id int primary key,modelo text,origen text,activo boolean);INSERT INTO sensor VALUES(1,'DHT11','real',true);
 CREATE TABLE variable(id smallint primary key,codigo text,unidad_id smallint);INSERT INTO variable VALUES(1,'TEMP',1),(2,'HUM',2);
 CREATE TABLE sensor_variable(sensor_id int,variable_id smallint);INSERT INTO sensor_variable VALUES(1,1),(1,2);
 CREATE TABLE lectura_original(id bigint generated always as identity primary key,sensor_id int,variable_id smallint,unidad_id smallint,id_muestra bigint,valor numeric,medido_en timestamptz,calidad text,UNIQUE(sensor_id,variable_id,id_muestra));
 CREATE TABLE lectura_cuarentena(id bigint generated always as identity primary key,payload jsonb,causa text,recibido_en timestamptz default now());
 CREATE TABLE auditoria_evento(id bigint generated always as identity primary key,usuario_id int,entidad text,entidad_id bigint,accion text,motivo text,datos_despues jsonb,creado_en timestamptz default now());`);
 const migration=fs.readFileSync(path.join(__dirname,'../db/05_revision_cuarentena.sql'),'utf8');await pool.query(migration);await pool.query(migration);
 const payload=i=>({sensorId:1,idMuestra:100+i,medidoEn:'2026-01-01T00:00:00Z',lecturas:[{variableCodigo:'TEMP',unidadId:1,valor:25},{variableCodigo:'HUM',unidadId:2,valor:50}]});
 for(let i=1;i<=6;i++){const p=payload(i);if(i===4)p.lecturas[1].valor=150;if(i===6)p.idMuestra=101;await pool.query('INSERT INTO lectura_cuarentena(payload,causa) VALUES($1,\'Atípica\')',[JSON.stringify(p)]);}
 const app=express();app.use(express.json());app.use('/api/admin/cuarentena',crearRouterCuarentena(pool,auth,admin));server=app.listen(15054,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 await req('GET','',null,0,401);await req('GET','',null,2,403);
 process.env.CUARENTENA_REVISION_HABILITADA='false';await decide(['1'],'restaurar',1,503);
 process.env.CUARENTENA_REVISION_HABILITADA='true';await decide(['1'],'restaurar',3,403);
 assert.equal((await req('GET','')).items.length,6);
 const [a,b]=await Promise.all([decide(['1']),decide(['1'])]);assert.ok(a.resultados[0].repetida!==b.resultados[0].repetida);
 assert.equal((await pool.query('SELECT count(*) n FROM lectura_original')).rows[0].n,'2');
 await decide(['1'],'descartar',1,409);
 await decide(['3','4'],'restaurar',1,422);assert.equal((await pool.query("SELECT count(*) n FROM auditoria_evento WHERE entidad_id IN (3,4)")).rows[0].n,'0');
 await decide(['2'],'descartar');assert.equal((await pool.query('SELECT count(*) n FROM lectura_cuarentena')).rows[0].n,'6');
 await decide(['6'],'restaurar',1,409);
 await decide(['3','5']);assert.equal((await pool.query('SELECT count(*) n FROM lectura_original')).rows[0].n,'6');
 const list=await req('GET','?estado=restaurada&limite=2');assert.equal(list.items.length,2);assert.equal((await req('GET','?estado=restaurada&despuesDe='+list.siguiente_despues_de)).items.length,1);
 await req('POST','/decisiones',{ids:['4'],accion:'descartar',motivo:'x'},1,400);
 await req('POST','/decisiones',{ids:['4','4'],accion:'descartar',motivo},1,400);
 await decide(['999'],'descartar',1,404);
 assert.equal((await pool.query('SELECT count(*) n FROM auditoria_evento')).rows[0].n,'4');
 console.log('OK',checks,'solicitudes verificadas; concurrencia, roles, lote atómico, validaciones e historial.');
}finally{if(server){server.closeAllConnections();server.close();}await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
