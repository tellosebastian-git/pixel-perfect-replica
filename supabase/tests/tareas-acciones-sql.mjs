// Real local PostgreSQL, synthetic data only. No remote URL or credentials accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const dep = name => pathToFileURL(resolve('node_modules/.admin-sql-test/node_modules', name)).href;
const { default: EmbeddedPostgres } = await import(dep('embedded-postgres/dist/index.js'));
process.env.TAREAS_FIXTURE_ONLY = '1';
const { build, seedWorld, W, asOwner } = await import('./tareas-automaticas-sql.mjs');
let migration = await readFile('supabase/migrations/20261014120000_tareas_acciones_controladas.sql','utf8');
// BUILD 4C: estado del aviso semanal. Las mutaciones marcadas 'aviso' se aplican sobre esta migración.
let aviso = await readFile('supabase/migrations/20261015120000_tareas_aviso_semanal.sql','utf8');
const mutations = [
  ['sin filtro de organización en autorización', 'p.id = p_actor AND p.organization_id = p_org', 'p.id = p_actor'],
  ['sin bloqueo de fila', "AND tipo = 'tarea' FOR UPDATE", "AND tipo = 'tarea'"],
  ['sin control de versión', 'IF t.accion_version IS DISTINCT FROM p_version THEN', 'IF false THEN'],
  ['deshacer por otro actor', 'v_undo.actor_id <> v_actor OR t.completada_por_id IS DISTINCT FROM v_actor', 'false'],
  ['deshacer vencido', 'OR v_undo.vence_at < v_now', 'OR false'],
  ['Manager usa permiso de Barbero', "NOT public.has_role(p_actor, 'manager') AND public.has_role(p_actor, 'barber')", "public.has_role(p_actor, 'barber')"],
  ['permite UUID de identidad desde cliente', "current_setting('role',true) IS DISTINCT FROM 'service_role' OR p_pin_hash IS NULL", 'false'],
  ['omite comparación del PIN', 'b.pin_hash = p_pin_hash', 'true'],
  ['permite edición directa de estado', "OLD.tipo = 'tarea' AND ROW", 'false AND ROW'],
  ['omite límite de PIN', 'IF v_rate.intentos >= 5 THEN', 'IF false THEN'],
  ['consulta disponible', 'AND bs.sucursal_id = p_sucursal', 'AND bs.sucursal_id = p_sucursal AND bs.disponible'],
  ['expone digest PIN al cliente', 'COMMIT;', 'GRANT SELECT(pin_hash) ON public.barberos TO authenticated; COMMIT;'],
  ['proyección sin alcance de lectura', "AND tareas_private.alcance(tr.organization_id, tr.sucursal_id, tr.asignado_a, tr.assignment_scope = 'team', false)", ''],
  ['proyección repite ocurrencias ya creadas', 'IF NOT EXISTS (SELECT 1 FROM public.tareas t WHERE t.recurrencia_id = r.id AND t.fecha_inicio = v_d) THEN', 'IF true THEN'],
  ['proyección incluye pausadas', 'tr.activo AND tr.pausa_motivo IS NULL', 'true'],
  ['proyección reconstruye fechas pasadas', 'GREATEST(p_desde, v_hoy, r.proxima_fecha) - 1', 'p_desde - 1'],
  ['proyección sin límite de rango', ' OR p_hasta - p_desde > 13', ''],
  ['aviso: lectura sin filtro de usuario', 'FOR SELECT TO authenticated\n  USING (user_id = auth.uid() AND', 'FOR SELECT TO authenticated\n  USING (', 'aviso'],
  ['aviso: alta sin filtro de organización', 'WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_organization_id(auth.uid())\n    AND NOT public.is_sucursal_account(auth.uid()));\nCREATE POLICY tareas_aviso_semanal_actualizar', 'WITH CHECK (user_id = auth.uid()\n    AND NOT public.is_sucursal_account(auth.uid()));\nCREATE POLICY tareas_aviso_semanal_actualizar', 'aviso'],
  ['aviso: cuenta de sucursal puede guardar estado', 'AND NOT public.is_sucursal_account(auth.uid()));\nCREATE POLICY tareas_aviso_semanal_actualizar', ');\nCREATE POLICY tareas_aviso_semanal_actualizar', 'aviso'],
  ['aviso: "Más tarde" con el reloj del dispositivo', "NEW.pospuesto_hasta := CASE WHEN NEW.estado = 'pospuesto' THEN clock_timestamp() + interval '3 hours' END;", "NEW.pospuesto_hasta := CASE WHEN NEW.estado = 'pospuesto' THEN coalesce(NEW.pospuesto_hasta, clock_timestamp() + interval '3 hours') END;", 'aviso'],
];
if(process.argv.includes('--mutation-check')) {
  let survived=0;
  for(const [i,[name]] of mutations.entries()) {
    const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url)],{env:{...process.env,TAREAS_ACTION_MUTATION:String(i)},encoding:'utf8',maxBuffer:8*1024*1024});
    const killed=run.status!==0 && `${run.stdout}${run.stderr}`.includes('AssertionError');
    if(!killed) survived++;
    console.log(`${killed?'KILLED':'SURVIVED/ERROR'} ${i+1}/${mutations.length}: ${name}`);
    if(!killed) console.log(`${run.stdout}${run.stderr}`.slice(-2000));
  }
  console.log(`Mutaciones 4A detectadas: ${mutations.length-survived}/${mutations.length}`); process.exit(survived?1:0);
}
if(process.env.TAREAS_ACTION_MUTATION!==undefined) {
  const [,from,to,objetivo]=mutations[Number(process.env.TAREAS_ACTION_MUTATION)];
  if(objetivo==='aviso') { assert.ok(aviso.includes(from)); aviso=aviso.replace(from,to); }
  else { assert.ok(migration.includes(from)); migration=migration.replace(from,to); }
}
const databaseDir = await mkdtemp(resolve(tmpdir(),'vittro-4a-'));
const pg = new EmbeddedPostgres({ databaseDir, user: 'postgres', password: randomUUID(), port: 55439,
  persistent: true, initdbFlags: ['--encoding=UTF8','--locale=C'], postgresFlags: ['-h','127.0.0.1'], onLog: () => {}, onError: () => {} });
const clients = [];
const connect = async () => { const c = pg.getPgClient(); await c.connect(); clients.push(c); return c; };
function adapter(c) { return { query: (sql, args) => c.query(sql,args), exec: sql => c.query(sql),
  transaction: async fn => { await c.query('BEGIN'); try { const r = await fn(adapter(c)); await c.query('COMMIT'); return r; } catch(e) { await c.query('ROLLBACK'); throw e; } } }; }
let passed = 0;
let c;
const session = async (user, role = 'authenticated', conn = c) => {
  await conn.query(`RESET ROLE; SET ROLE ${role}`);
  await conn.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[W[user] ?? user ?? '']);
};
const admin = () => session('', 'app_owner');
const makeTask = async (options = {}) => {
  await admin();
  const {rows:[r]} = await c.query(`INSERT INTO public.tareas(organization_id,sucursal_id,tipo,titulo,estado,assignment_scope,asignado_a_id,creado_por_id)
    VALUES($1,$2,$3,'Prueba 4A',$4,$5,$6,$7) RETURNING *`,
    [options.org ?? W.orgA, options.branch === null ? null : options.branch ?? W.S1, options.tipo ?? 'tarea', options.estado ?? 'pendiente',
      options.team ? 'team' : 'individual', options.team ? null : options.barber ?? W.bar1, W.ownerA]);
  return r;
};
const action = async (user,t,op,conn = c) => {
  await session(user,'authenticated',conn);
  return (await conn.query('SELECT public.tareas_accion($1,$2,$3) AS result',[t.id,op,t.accion_version ?? t.version])).rows[0].result;
};
const pin = async (t,hash,account = W.saS1,op = 'completar') => {
  await session('', 'service_role');
  return (await c.query('SELECT public.tareas_accion_pin($1,$2,$3,$4,$5) AS result',[t.id,op,t.accion_version ?? t.version,account,hash])).rows[0].result;
};
const test = async (name,fn) => {
  await c.query('RESET ROLE; BEGIN');
  try { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
  finally { await c.query('ROLLBACK; RESET ROLE'); }
};
const reject = async (sql,args,pattern) => {
  await c.query('SAVEPOINT rejection');
  await assert.rejects(c.query(sql,args),pattern);
  await c.query('ROLLBACK TO SAVEPOINT rejection');
};
try {
  await pg.initialise(); await pg.start(); c = await connect();
  await build('m5',adapter(c));
  await c.query('GRANT CREATE ON DATABASE postgres TO app_owner; GRANT REFERENCES ON auth.users TO app_owner');
  await seedWorld(adapter(c));
  await asOwner(adapter(c), "ALTER TABLE public.barberos ADD COLUMN pin_hash text");
  // The seed intentionally models multiple profiles linked to bar1; remove ambiguity for normal PIN cases.
  await c.query('UPDATE public.profiles SET barbero_id = NULL WHERE id = $1',[W.barberS1b]);
  await c.query("UPDATE public.barberos SET pin_hash = 'valid-hash' WHERE id = $1",[W.bar1]);
  await asOwner(adapter(c),await readFile('supabase/migrations/20261013120000_tareas_integridad_post_reset.sql','utf8'));
  // Migration uses explicit BEGIN/COMMIT, so set owner at session level.
  await c.query('SET ROLE app_owner'); await c.query(migration); await c.query(aviso); await c.query('RESET ROLE');

  for (const user of ['ownerA','gmA','mgrS1','barberS1']) {
    await test(`${user}: iniciar propia, completar y deshacer conserva en_progreso`,async()=>{
      const t = await makeTask();
      const started = await action(user,t,'iniciar'); assert.equal(started.ok,true); assert.ok(started.iniciada_at);
      const completed = await action(user,{id:t.id,...started},'completar'); assert.equal(completed.ok,true); assert.ok(completed.completada_at);
      const undone = await action(user,{id:t.id,...completed},'deshacer'); assert.equal(undone.estado,'en_progreso');
      assert.equal(undone.iniciada_at,started.iniciada_at);
    });
    await test(`${user}: deshacer desde pendiente conserva pendiente`,async()=>{
      const t = await makeTask(); const done = await action(user,t,'completar');
      assert.equal((await action(user,{id:t.id,...done},'deshacer')).estado,'pendiente');
    });
    await test(`${user}: puede iniciar vencida`,async()=>{
      const t = await makeTask({estado:'vencida'}); assert.equal((await action(user,t,'iniciar')).estado,'en_progreso');
    });
    await test(`${user}: equipo en sucursal permitida`,async()=>{
      const t = await makeTask({team:true}); assert.equal((await action(user,t,'completar')).ok,true);
    });
    await test(`${user}: otra organización rechazada y oculta`,async()=>{
      const t = await makeTask({org:W.orgB,branch:W.SB1,barber:W.barB1});
      assert.equal((await action(user,t,'completar')).code,'forbidden');
      assert.equal((await c.query('SELECT id FROM tareas WHERE id=$1',[t.id])).rowCount,0);
    });
  }
  for (const user of ['mgrS2','barberS1','ownerB','saS1']) {
    await test(`${user}: denegación de acción fuera de alcance`,async()=>{
      const t = await makeTask(user === 'barberS1' ? {barber:W.bar2} : {});
      assert.equal((await action(user,t,'completar')).ok,false);
    });
  }
  await test('Manager lee y edita solo sus sucursales; Owner y GM conservan ambas',async()=>{
    const a=await makeTask(); const b=await makeTask({branch:W.S2});
    await session('mgrS1'); assert.equal((await c.query('SELECT id FROM tareas WHERE id=ANY($1::uuid[])',[[a.id,b.id]])).rowCount,1);
    assert.equal((await c.query("UPDATE tareas SET titulo='Permitido' WHERE id=$1",[a.id])).rowCount,1);
    assert.equal((await c.query("UPDATE tareas SET titulo='Prohibido' WHERE id=$1",[b.id])).rowCount,0);
    for(const user of ['ownerA','gmA']) { await session(user); assert.equal((await c.query('SELECT id FROM tareas WHERE id=ANY($1::uuid[])',[[a.id,b.id]])).rowCount,2); }
  });
  await test('Barbero no edita campos administrativos ni borra; cuenta de sucursal tampoco',async()=>{
    const t=await makeTask(); for(const user of ['barberS1','saS1']) {
      await session(user);
      assert.equal((await c.query("UPDATE tareas SET titulo='Ataque',descripcion='Ataque',asignado_a_id=$2 WHERE id=$1",[t.id,W.bar2])).rowCount,0);
      assert.equal((await c.query('DELETE FROM tareas WHERE id=$1',[t.id])).rowCount,0);
      await reject("INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,creado_por_id) VALUES($1,$2,'tarea','Ataque',$3)",[W.orgA,W.S1,W[user]],/row-level security/);
    }
  });
  await test('No hay escritura directa de estado/actores, ni actor suministrado al RPC personal',async()=>{
    const t=await makeTask(); await session('ownerA');
    await reject("UPDATE tareas SET estado='completada',completada_por_id=$2 WHERE id=$1",[t.id,W.barberS1],/acciones controladas/);
    await reject('SELECT public.tareas_accion($1,$2,$3,$4)',[t.id,'completar',t.accion_version,W.ownerB],/does not exist/);
    await reject('SELECT tareas_private.accion($1,$2,$3,$4,$5)',[t.id,'completar',t.accion_version,W.saS1,'valid-hash'],/Canal de PIN/);
    await reject('SELECT public.tareas_accion_pin($1,$2,$3,$4,$5)',[t.id,'completar',t.accion_version,W.saS1,'valid-hash'],/permission denied/);
  });
  await test('Equipo usa pertenencia estructural, ignora disponible y user_sucursales histórica',async()=>{
    const t=await makeTask({team:true}); await c.query('UPDATE barberos_sucursales SET disponible=false WHERE barbero_id=$1',[W.bar1]);
    await c.query('DELETE FROM user_sucursales WHERE user_id=$1',[W.barberS1]);
    assert.equal((await action('barberS1',t,'iniciar')).ok,true);
    await admin(); await c.query('DELETE FROM barberos_sucursales WHERE barbero_id=$1',[W.bar1]);
    await session('barberS1'); assert.equal((await c.query('SELECT id FROM tareas WHERE id=$1',[t.id])).rowCount,0);
  });
  await test('Pertenencia temporal futura/vencida no autoriza',async()=>{
    for(const offset of [10,-10]) {
      const t=await makeTask({team:true});
      await c.query("UPDATE barberos_sucursales SET tipo='temporal',fecha_inicio=current_date+$2::int,fecha_fin=current_date+$2::int+1 WHERE barbero_id=$1",[W.bar1,offset]);
      assert.equal((await action('barberS1',t,'completar')).ok,false);
    }
  });
  await test('PIN incorrecto, correcto y actor real; deshacer mediante el mismo PIN',async()=>{
    const t=await makeTask(); assert.equal((await pin(t,'incorrect')).code,'invalid_pin');
    const done=await pin(t,'valid-hash'); assert.equal(done.ok,true);
    await admin(); assert.equal((await c.query('SELECT completada_por_id FROM tareas WHERE id=$1',[t.id])).rows[0].completada_por_id,W.barberS1);
    assert.equal((await pin({id:t.id,...done},'valid-hash',W.saS1,'deshacer')).estado,'pendiente');
  });
  await test('PIN exige cuenta/sucursal/rol/pertenencia y rechaza identidad ambigua',async()=>{
    const t=await makeTask({branch:W.S2}); assert.equal((await pin(t,'valid-hash')).code,'forbidden');
    const a=await makeTask(); assert.equal((await pin(a,'valid-hash',W.ownerA)).code,'forbidden');
    await admin(); await c.query('UPDATE profiles SET barbero_id=$1 WHERE id=$2',[W.bar1,W.barberS1b]);
    assert.equal((await pin(a,'valid-hash')).code,'invalid_pin');
  });
  await test('PIN tiene límite persistente de intentos',async()=>{
    const t=await makeTask(); for(let i=0;i<5;i++) assert.equal((await pin(t,'incorrect')).code,'invalid_pin');
    assert.equal((await pin(t,'valid-hash')).code,'rate_limit');
  });
  await test('El cliente no lee ni escribe hashes; conserva los campos de equipo y el servidor configura PIN',async()=>{
    await session('ownerA');
    for(const permission of ['SELECT','INSERT','UPDATE']) {
      const result=await c.query("SELECT has_column_privilege('authenticated','public.barberos','pin_hash',$1) AS allowed",[permission]);
      assert.equal(result.rows[0].allowed,false);
    }
    assert.ok((await c.query('SELECT id,nombre,apellido,activo FROM barberos')).rowCount>0);
    await reject('SELECT pin_hash FROM barberos WHERE id=$1',[W.bar1],/permission denied/);
    await reject("UPDATE barberos SET pin_hash='forged' WHERE id=$1",[W.bar1],/permission denied/);
    await session('','service_role');
    assert.equal((await c.query("UPDATE barberos SET pin_hash='valid-hash' WHERE id=$1",[W.bar1])).rowCount,1);
  });
  await test('PIN de Owner/GM/Manager conserva sus alcances reales',async()=>{
    for(const [user,barbero] of [['ownerA',W.barOwnerA],['gmA',W.bar2],['mgrS1',W.bar3]]) {
      const t=await makeTask({team:true});
      await c.query('UPDATE profiles SET barbero_id=$1 WHERE id=$2',[barbero,W[user]]);
      await c.query('UPDATE barberos SET pin_hash=$1 WHERE id=$2',[`hash-${user}`,barbero]);
      assert.equal((await pin(t,`hash-${user}`)).ok,true);
    }
    const t=await makeTask({team:true});
    await c.query('DELETE FROM user_sucursales WHERE user_id=$1',[W.mgrS1]);
    assert.equal((await pin(t,'hash-mgrS1')).code,'forbidden');
  });
  await test('Las peticiones mantienen creación y resolución por las vías previas',async()=>{
    await session('barberS1');
    await reject("INSERT INTO tareas(organization_id,tipo,titulo,creado_por_id) VALUES($1,'peticion','Petición bloqueada',$2)",[W.orgA,W.barberS1],/barberos no pueden crear peticiones/);
    await session('ownerA');
    const p=(await c.query("INSERT INTO tareas(organization_id,tipo,titulo,creado_por_id) VALUES($1,'peticion','Petición original',$2) RETURNING id",[W.orgA,W.ownerA])).rows[0];
    await session('ownerA');assert.equal((await c.query("UPDATE tareas SET estado='completada' WHERE id=$1",[p.id])).rowCount,1);
    assert.equal((await c.query('SELECT sucursal_id FROM tareas WHERE id=$1',[p.id])).rows[0].sucursal_id,null);
  });
  await test('Roles combinados no amplían Manager ni cuenta de sucursal',async()=>{
    const t=await makeTask({team:true,branch:W.S2});
    await c.query("INSERT INTO user_roles(user_id,role) VALUES($1,'manager')",[W.barberS1]);
    await c.query("INSERT INTO barberos_sucursales(organization_id,sucursal_id,barbero_id,tipo) VALUES($1,$2,$3,'recurrente')",[W.orgA,W.S2,W.bar1]);
    assert.equal((await action('barberS1',t,'completar')).ok,false);
    await session('barberS1');assert.equal((await c.query('SELECT id FROM tareas WHERE id=$1',[t.id])).rowCount,0);
    const a=await makeTask();await c.query("INSERT INTO user_roles(user_id,role) VALUES($1,'owner')",[W.saS1]);
    await session('saS1');assert.equal((await c.query("UPDATE tareas SET titulo='Ataque' WHERE id=$1",[a.id])).rowCount,0);
    assert.equal((await action('saS1',a,'completar')).code,'pin_required');
  });
  await test('Cuenta de sucursal inicia/completa equipo con PIN y rechaza tarea ajena/otro tenant',async()=>{
    const t=await makeTask({team:true,estado:'vencida'});
    const started=await pin(t,'valid-hash',W.saS1,'iniciar');assert.equal(started.estado,'en_progreso');
    const done=await pin({id:t.id,...started},'valid-hash');assert.equal(done.ok,true);
    assert.equal((await pin({id:t.id,...done},'valid-hash',W.saS1,'deshacer')).estado,'en_progreso');
    const other=await makeTask({barber:W.bar2});assert.equal((await pin(other,'valid-hash')).code,'forbidden');
    const foreign=await makeTask({org:W.orgB,branch:W.SB1,barber:W.barB1});assert.equal((await pin(foreign,'valid-hash')).code,'forbidden');
  });
  await test('Manager no puede leer recetas de otra sucursal; motor conserva generación y notificaciones',async()=>{
    await admin();
    const recipe=async branch=>(await c.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,fecha_inicio,proxima_fecha,repeat_preset,created_by)
      VALUES($1,$2,'Automática 4A','team',public._tareas_auto_hoy($1),public._tareas_auto_hoy($1),'daily',$3) RETURNING id`,[W.orgA,branch,W.ownerA])).rows[0].id;
    const a=await recipe(W.S1); const b=await recipe(W.S2);
    const generated=(await c.query('SELECT id,sucursal_id FROM tareas WHERE recurrencia_id=ANY($1::uuid[])',[[a,b]])).rows;
    assert.equal(generated.length,2);
    assert.ok((await c.query("SELECT id FROM notifications WHERE source_module='tareas' AND source_id=ANY($1::uuid[])",[generated.map(t=>t.id)])).rowCount>0);
    await session('mgrS1');assert.equal((await c.query('SELECT id FROM tareas_recurrentes WHERE id=ANY($1::uuid[])',[[a,b]])).rowCount,1);
    assert.equal((await c.query("UPDATE tareas_recurrentes SET titulo='Fuera' WHERE id=$1",[b])).rowCount,0);
  });
  await test('Deshacer por otro actor, fuera de plazo o tras edición posterior se rechaza',async()=>{
    const t=await makeTask(); const done=await action('ownerA',t,'completar'); const completed={id:t.id,...done};
    assert.equal((await action('gmA',completed,'deshacer')).code,'undo_denied');
    await admin(); await c.query("UPDATE tareas_private.completados SET vence_at=clock_timestamp()-interval '1 second' WHERE tarea_id=$1",[t.id]);
    assert.equal((await action('ownerA',completed,'deshacer')).code,'undo_denied');
    await admin(); await c.query("UPDATE tareas_private.completados SET vence_at=clock_timestamp()+interval '30 seconds' WHERE tarea_id=$1",[t.id]);
    await session('ownerA'); await c.query("UPDATE tareas SET titulo='Edición posterior' WHERE id=$1",[t.id]);
    assert.equal((await action('ownerA',completed,'deshacer')).code,'conflict');
  });
  await test('Tarea sin sucursal rechazada, sucursal/responsable cross-tenant rechazados; petición nula intacta',async()=>{
    await admin();
    await reject("INSERT INTO tareas(organization_id,tipo,titulo) VALUES($1,'tarea','Inválida')",[W.orgA],/sucursal/);
    await reject("INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo) VALUES($1,$2,'tarea','Inválida')",[W.orgA,W.SB1],/organización/);
    const p=await makeTask({tipo:'peticion',branch:null}); assert.equal(p.tipo,'peticion');
    assert.equal((await action('ownerA',p,'completar')).code,'forbidden');
  });
  // R1: proyecciones de Tareas automáticas. Fechas relativas al "hoy" real de la organización.
  const dayAdd = (iso,n) => new Date(Date.parse(`${iso}T00:00:00Z`)+n*86_400_000).toISOString().slice(0,10);
  const hoyA = async () => { await admin(); return (await c.query('SELECT public._tareas_auto_hoy($1)::text AS d',[W.orgA])).rows[0].d; };
  const mkReceta = async (o = {}) => {
    await admin();
    return (await c.query(`INSERT INTO tareas_recurrentes(organization_id,sucursal_id,titulo,assignment_scope,asignado_a,fecha_inicio,proxima_fecha,
      repeat_preset,repeat_frequency,repeat_interval,repeat_byweekday,created_by) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [W.orgA,o.branch ?? W.S1,o.titulo ?? 'Receta R1',o.barber ? 'individual' : 'team',o.barber ?? null,o.inicio,o.preset ?? 'daily',
        o.freq ?? null,o.interval ?? null,o.byday ?? null,W.ownerA])).rows[0].id;
  };
  const previstas = async (user,desde,hasta,branch = null) => {
    await session(user);
    return (await c.query('SELECT recurrencia_id,fecha::text AS fecha FROM public.tareas_previstas($1::date,$2::date,$3::uuid) ORDER BY fecha',[desde,hasta,branch])).rows;
  };
  await test('Proyecciones: serie canónica futura, sin la ocurrencia ya creada ni fechas pasadas',async()=>{
    const hoy=await hoyA(); const id=await mkReceta({inicio:dayAdd(hoy,-5)});
    await admin(); assert.equal((await c.query('SELECT 1 FROM tareas WHERE recurrencia_id=$1 AND fecha_inicio=$2',[id,hoy])).rowCount,1);
    const rows=(await previstas('ownerA',dayAdd(hoy,-3),dayAdd(hoy,6))).filter(r=>r.recurrencia_id===id).map(r=>r.fecha);
    assert.deepEqual(rows,[1,2,3,4,5,6].map(n=>dayAdd(hoy,n)));
    await admin(); await c.query(`INSERT INTO tareas(organization_id,sucursal_id,tipo,titulo,assignment_scope,recurrencia_id,fecha_inicio)
      VALUES($1,$2,'tarea','Ya creada','team',$3,$4)`,[W.orgA,W.S1,id,dayAdd(hoy,2)]);
    const after=(await previstas('ownerA',hoy,dayAdd(hoy,6))).filter(r=>r.recurrencia_id===id).map(r=>r.fecha);
    assert.equal(after.includes(dayAdd(hoy,2)),false); assert.equal(after.length,5);
  });
  await test('Proyecciones: ancla quincenal, días personalizados y pausadas excluidas',async()=>{
    const hoy=await hoyA();
    const quincenal=await mkReceta({inicio:dayAdd(hoy,-7),preset:'biweekly'});
    const dows=[1,3].map(n=>new Date(`${dayAdd(hoy,n)}T00:00:00Z`).getUTCDay());
    const custom=await mkReceta({inicio:hoy,preset:'custom',freq:'weekly',interval:1,byday:dows});
    const pausada=await mkReceta({inicio:hoy});
    await admin(); await c.query("UPDATE tareas_recurrentes SET activo=false,pausa_motivo='manual',pausada_at=now() WHERE id=$1",[pausada]);
    const rows=await previstas('ownerA',hoy,dayAdd(hoy,13));
    assert.deepEqual(rows.filter(r=>r.recurrencia_id===quincenal).map(r=>r.fecha),[dayAdd(hoy,7)]);
    assert.deepEqual(rows.filter(r=>r.recurrencia_id===custom).map(r=>r.fecha).slice(0,2),[dayAdd(hoy,1),dayAdd(hoy,3)]);
    assert.equal(rows.some(r=>r.recurrencia_id===pausada),false);
  });
  await test('Proyecciones respetan alcance por rol, sucursal y organización; rango acotado',async()=>{
    const hoy=await hoyA();
    const ids={teamS1:await mkReceta({inicio:hoy}),teamS2:await mkReceta({inicio:hoy,branch:W.S2}),
      bar1:await mkReceta({inicio:hoy,barber:W.bar1}),bar2:await mkReceta({inicio:hoy,barber:W.bar2})};
    const seen=async (user,branch=null)=>{
      const visibles=new Set((await previstas(user,hoy,dayAdd(hoy,6),branch)).map(r=>r.recurrencia_id));
      return Object.keys(ids).filter(k=>visibles.has(ids[k])).sort();
    };
    for(const user of ['ownerA','gmA']) assert.deepEqual(await seen(user),['bar1','bar2','teamS1','teamS2']);
    assert.deepEqual(await seen('mgrS1'),['bar1','bar2','teamS1']);
    assert.deepEqual(await seen('mgrS2'),['teamS2']);
    assert.deepEqual(await seen('barberS1'),['bar1','teamS1']);
    assert.deepEqual(await seen('saS1'),['bar1','bar2','teamS1']);
    assert.deepEqual(await seen('ownerB'),[]);
    assert.deepEqual(await seen('ownerA',W.S2),['teamS2']);
    await session('ownerA');
    await reject('SELECT * FROM public.tareas_previstas($1::date,$2::date)',[hoy,dayAdd(hoy,14)],/Rango/);
    for(const fn of ['public._tareas_auto_siguiente(date,text,text,integer,integer[],date)','tareas_private.previstas(date,date,uuid)']) {
      const anon=(await c.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS ok",[fn])).rows[0].ok; assert.equal(anon,false);
    }
    assert.equal((await c.query("SELECT has_function_privilege('authenticated','public._tareas_auto_siguiente(date,text,text,integer,integer[],date)','EXECUTE') AS ok")).rows[0].ok,false);
  });
  // BUILD 4C: estado del aviso semanal (usuario + organización + semana + momento), sin contenido de tareas.
  const lunesA = async () => { await admin(); return (await c.query("SELECT public._tareas_auto_lunes(public._tareas_auto_hoy($1))::text AS d",[W.orgA])).rows[0].d; };
  const guardarAviso = async (user, fila) => {
    await session(user);
    return (await c.query(`INSERT INTO public.tareas_aviso_semanal(organization_id,semana,momento,estado,pospuesto_hasta)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id,organization_id,semana,momento) DO UPDATE SET estado=EXCLUDED.estado,pospuesto_hasta=EXCLUDED.pospuesto_hasta
      RETURNING estado,pospuesto_hasta,user_id`,[fila.org ?? W.orgA,fila.semana,fila.momento ?? 'lunes',fila.estado,fila.hasta ?? null])).rows[0];
  };
  await test('Aviso semanal: "Más tarde" lo fija el servidor (3 h) y "Listo" no deja plazo',async()=>{
    const semana=await lunesA();
    const pospuesto=await guardarAviso('ownerA',{semana,estado:'pospuesto',hasta:'2000-01-01T00:00:00Z'});
    assert.equal(pospuesto.user_id,W.ownerA);
    const horas=(new Date(pospuesto.pospuesto_hasta).getTime()-Date.now())/3_600_000;
    assert.ok(horas>2.9 && horas<3.1,`plazo de 3 h según el servidor, no el enviado (${horas})`);
    const listo=await guardarAviso('ownerA',{semana,estado:'listo'});
    assert.equal(listo.estado,'listo'); assert.equal(listo.pospuesto_hasta,null);
  });
  await test('Aviso semanal: el upsert del cliente (como lo arma PostgREST) pasa de Listo a Más tarde y vuelve',async()=>{
    const semana=await lunesA(); await session('gmA');
    // Mismo SQL que `upsert(..., { onConflict })`: todas las columnas enviadas, sin pospuesto_hasta.
    const upsert=async estado=>(await c.query(`INSERT INTO public.tareas_aviso_semanal(user_id,organization_id,semana,momento,estado)
      VALUES($1,$2,$3,'sabado',$4) ON CONFLICT (user_id,organization_id,semana,momento)
      DO UPDATE SET user_id=EXCLUDED.user_id,organization_id=EXCLUDED.organization_id,semana=EXCLUDED.semana,momento=EXCLUDED.momento,estado=EXCLUDED.estado
      RETURNING estado,pospuesto_hasta`,[W.gmA,W.orgA,semana,estado])).rows[0];
    assert.equal((await upsert('listo')).pospuesto_hasta,null);
    const pospuesto=await upsert('pospuesto');
    assert.equal(pospuesto.estado,'pospuesto');
    assert.ok(new Date(pospuesto.pospuesto_hasta).getTime()-Date.now()>2.9*3_600_000,'el plazo lo pone el servidor también al actualizar');
    assert.equal((await upsert('listo')).pospuesto_hasta,null);
    assert.equal((await c.query('SELECT 1 FROM public.tareas_aviso_semanal WHERE semana=$1 AND momento=$2',[semana,'sabado'])).rowCount,1);
  });
  await test('Aviso semanal: cada usuario solo ve y cambia su estado, en su organización',async()=>{
    const semana=await lunesA(); await guardarAviso('ownerA',{semana,estado:'listo',momento:'jueves'});
    await session('gmA');
    assert.equal((await c.query('SELECT 1 FROM public.tareas_aviso_semanal WHERE user_id=$1',[W.ownerA])).rowCount,0);
    assert.equal((await c.query("UPDATE public.tareas_aviso_semanal SET estado='pospuesto' WHERE user_id=$1",[W.ownerA])).rowCount,0);
    await reject("INSERT INTO public.tareas_aviso_semanal(user_id,organization_id,semana,momento,estado) VALUES($1,$2,$3,'jueves','listo')",[W.ownerA,W.orgA,semana],/row-level security/);
    await session('ownerA');
    await reject("INSERT INTO public.tareas_aviso_semanal(organization_id,semana,momento,estado) VALUES($1,$2,'jueves','listo')",[W.orgB,semana],/row-level security/);
    await session('ownerB');
    assert.equal((await c.query('SELECT 1 FROM public.tareas_aviso_semanal')).rowCount,0);
  });
  await test('Aviso semanal: cuenta de sucursal sin estado, anon sin acceso, sin borrar ni guardar contenido',async()=>{
    const semana=await lunesA();
    await session('saS1');
    await reject("INSERT INTO public.tareas_aviso_semanal(organization_id,semana,momento,estado) VALUES($1,$2,'lunes','listo')",[W.orgA,semana],/row-level security/);
    await guardarAviso('ownerA',{semana,estado:'listo'});
    await reject('DELETE FROM public.tareas_aviso_semanal WHERE user_id=$1',[W.ownerA],/permission denied/);
    await session('', 'anon');
    await reject('SELECT 1 FROM public.tareas_aviso_semanal',[],/permission denied/);
    await session('ownerA');
    await reject("INSERT INTO public.tareas_aviso_semanal(organization_id,semana,momento,estado) VALUES($1,$2::date + 2,'lunes','listo')",[W.orgA,semana],/tareas_aviso_semanal_lunes/);
    await reject("INSERT INTO public.tareas_aviso_semanal(organization_id,semana,momento,estado) VALUES($1,$2,'domingo','listo')",[W.orgA,semana],/tareas_aviso_semanal_momento/);
    await admin();
    const columnas=(await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='tareas_aviso_semanal' ORDER BY ordinal_position")).rows.map(r=>r.column_name);
    assert.deepEqual(columnas,['user_id','organization_id','semana','momento','estado','pospuesto_hasta','updated_at']);
    const fn=(await c.query("SELECT prosecdef, has_function_privilege('authenticated',oid,'EXECUTE') AS auth FROM pg_proc WHERE proname='tareas_aviso_semanal_preparar'")).rows[0];
    assert.equal(fn.prosecdef,false); assert.equal(fn.auth,false);
  });
  await test('Historial: índice parcial por organización y fecha de completado',async()=>{
    await admin(); const def=(await c.query("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='idx_tareas_historial_completadas'")).rows[0]?.indexdef ?? '';
    assert.match(def,/\(organization_id, completada_at DESC NULLS LAST, id DESC\)/); assert.match(def,/estado = 'completada'/); assert.match(def,/tipo = 'tarea'/);
  });
  await test('Funciones públicas INVOKER, privadas con search_path fijo y sin EXECUTE público/anon',async()=>{
    await admin(); const funcs=(await c.query("SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='tareas_private' OR p.proname IN ('tareas_accion','tareas_accion_pin','tareas_previstas')")).rows;
    assert.ok(funcs.length>=9); for(const f of funcs) { assert.equal(f.anon,false); assert.ok(f.proconfig.includes('search_path=""')); if(f.nspname==='public') assert.equal(f.prosecdef,false); }
  });
  // Separate real connections and an uncommitted first completion: prove the second waits, then loses.
  const t=await makeTask({team:true}); const c1=await connect(); const c2=await connect();
  await c1.query('BEGIN'); const first=await action('ownerA',t,'completar',c1); assert.equal(first.ok,true);
  let settled=false; const competing=action('gmA',t,'completar',c2).then(r=>{settled=true;return r;});
  await new Promise(r=>setTimeout(r,150)); assert.equal(settled,false,'second completion must wait for row lock');
  await c1.query('COMMIT'); assert.equal((await competing).code,'conflict');
  await admin(); const final=(await c.query('SELECT completada_por_id,completada_at FROM tareas WHERE id=$1',[t.id])).rows[0];
  assert.equal(final.completada_por_id,W.ownerA); assert.equal(final.completada_at.toISOString(),new Date(first.completada_at).toISOString());
  console.log(`ok ${++passed} - dos conexiones: una gana, otra espera y no sobrescribe actor/timestamp`);
  const changing=await makeTask({team:true});await c1.query('BEGIN');
  const started=await action('ownerA',changing,'iniciar',c1);assert.equal(started.estado,'en_progreso');
  const staleComplete=action('gmA',changing,'completar',c2);
  await new Promise(r=>setTimeout(r,150));await c1.query('COMMIT');
  assert.equal((await staleComplete).code,'conflict');
  assert.equal((await action('gmA',{id:changing.id,...started},'completar',c2)).estado,'completada');
  console.log(`ok ${++passed} - cambio concurrente de estado exige refrescar versión antes de completar`);
  console.log(`Tareas 4A + 4C: ${passed} pruebas SQL aprobadas en PostgreSQL real local.`);
  if(process.argv.includes('--generate-types')) {
    const { regenerate } = await import('./tareas-generate-types.mjs'); await c.query('RESET ROLE'); await regenerate(c);
  }
} finally {
  for(const client of clients) await client.end().catch(()=>{});
  await pg.stop().catch(()=>{});
  // Retain isolated synthetic cluster for diagnostics; never remove an unchecked computed Windows path.
}
