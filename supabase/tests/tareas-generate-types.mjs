// Scoped regeneration using Supabase's official introspector/generator against the locally migrated DB.
// Preserve unrelated generated schema: the local security fixture contains only the affected modules.
// No handwritten column or RPC signatures. Run tareas-acciones-sql.mjs --generate-types.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const dep = name => pathToFileURL(resolve('node_modules/.admin-sql-test/node_modules/@supabase/postgrest-typegen/dist',name)).href;
export async function regenerate(db) {
  const { introspect } = await import(dep('introspection/index.js'));
  const { generateTypescript, sortGeneratorMetadata } = await import(dep('generation/index.js'));
  const metadata = await introspect(db,{includedSchemas:['public']});
  const generated = await generateTypescript(sortGeneratorMetadata(metadata),{postgrestVersion:'13.0.5',format: s=>s});
  const path='src/integrations/supabase/types.ts';
  const current=await readFile(path,'utf8');
  const source=s=>ts.createSourceFile('types.ts',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const fresh=source(generated); const old=source(current);
  const schema=file=>file.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='Database').type;
  const member=(node,name)=>node.members.find(m=>m.name?.getText().replaceAll('"','')===name);
  const at=(file,names)=>names.reduce((n,name)=>member(n,name)?.type,schema(file));
  const edits=[];
  for(const shape of ['Row','Insert','Update']) {
    const freshShape=at(fresh,['public','Tables','tareas',shape]);
    const oldShape=at(old,['public','Tables','tareas',shape]);
    assert(freshShape&&oldShape);
    for(const name of ['iniciada_por_id','iniciada_por_nombre','iniciada_at','accion_version']) {
      const f=member(freshShape,name); assert(f,`Generator missing ${name}`);
      const existing=member(oldShape,name);
      if(existing) edits.push({start:existing.getStart(old),end:existing.end,text:f.getText(fresh)});
      else edits.push({start:oldShape.end-1,end:oldShape.end-1,text:`  ${f.getText(fresh)}\n        `});
    }
  }
  // BUILD 4C: tabla de estado del aviso semanal, completa desde el generador.
  const freshTables=at(fresh,['public','Tables']); const oldTables=at(old,['public','Tables']);
  for(const name of ['tareas_aviso_semanal']) {
    const f=member(freshTables,name); assert(f,`Generator missing ${name}`); const existing=member(oldTables,name);
    edits.push(existing ? {start:existing.getStart(old),end:existing.end,text:f.getText(fresh)} :
      {start:oldTables.end-1,end:oldTables.end-1,text:`  ${f.getText(fresh)}\n    `});
  }
  const freshFuncs=at(fresh,['public','Functions']); const oldFuncs=at(old,['public','Functions']);
  for(const name of ['tareas_accion','tareas_accion_pin','tareas_previstas']) {
    const f=member(freshFuncs,name); assert(f); const existing=member(oldFuncs,name);
    edits.push(existing ? {start:existing.getStart(old),end:existing.end,text:f.getText(fresh)} :
      {start:oldFuncs.end-1,end:oldFuncs.end-1,text:`  ${f.getText(fresh)}\n    `});
  }
  let result=current;
  for(const e of edits.sort((a,b)=>b.start-a.start)) result=result.slice(0,e.start)+e.text+result.slice(e.end);
  assert.equal(source(result).parseDiagnostics.length,0);
  await writeFile(path,result);
  console.log('Tipos regenerados desde PostgreSQL local con @supabase/postgrest-typegen 0.4.0; resto del schema conservado.');
}
