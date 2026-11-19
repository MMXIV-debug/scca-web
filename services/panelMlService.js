const express = require('express');
function crearRouterPanelMl(pool, auth, soloAdmin) {
 const router=express.Router();router.use(auth,soloAdmin);
 router.get('/politicas',async(req,res)=>{try{
 const {rows}=await pool.query(`SELECT id,version,agregado_min,completitud_min_pct,colocacion_dias,pares_minimos,test_pct,mejora_rmse_min_pct,sin_datos_seg,vigente_desde,vigente_hasta,motivo FROM politica_ml ORDER BY version DESC LIMIT 100`);
 res.json({items:rows});}catch{res.status(503).json({error:'No se pudieron consultar las políticas.'});}});
 router.get('/modelos',async(req,res)=>{try{
 const {rows}=await pool.query(`SELECT version,sensor_id,nodo_id,perfil,proposito,horizonte_h,metadatos,registrado_en FROM ml_demo_version ORDER BY registrado_en DESC LIMIT 100`);
 res.json({items:rows,ambito:'demostracion'});}catch{res.status(503).json({error:'No se pudieron consultar modelos. Comprueba la migración 04 y los permisos.'});}});
 router.get('/reportes',async(req,res)=>{const sensor=Number(req.query.sensorId),cursor=req.query.despuesDe||'0';
 if(!Number.isSafeInteger(sensor)||sensor<=0||!/^\d{1,18}$/.test(cursor))return res.status(400).json({error:'Indica un sensor válido.'});
 try{const {rows}=await pool.query(`SELECT r.id::text,r.periodo_inicio,r.periodo_fin,r.resultado,v.version,v.proposito,v.horizonte_h FROM ml_demo_resultado r JOIN ml_demo_version v ON v.version=r.version WHERE v.sensor_id=$1 AND r.id>$2 ORDER BY r.id LIMIT 100`,[sensor,cursor]);
 res.json({items:rows,siguiente_despues_de:rows.at(-1)?.id||cursor,ambito:'demostracion'});}catch{res.status(503).json({error:'No se pudieron consultar resultados. Comprueba la migración 04 y los permisos.'});}});
 return router;
}
module.exports={crearRouterPanelMl};
