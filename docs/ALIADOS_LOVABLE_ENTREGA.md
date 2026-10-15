# Programa de aliados — entrega de datos a Lovable

Contrato inicial v1 conservado como antecedente. La vía Instagram fue retirada
por el usuario; reglas y rollout v2 en [ALIADOS_NIVELES_REFERIDOS.md](ALIADOS_NIVELES_REFERIDOS.md).

Estado: contrato implementado y aplicado al proyecto operativo el 2026-10-14,
con excepción explícita del usuario: «podemos ir a produccion directamente».
El nombre del documento conserva la entrega originalmente prevista para Lovable.
Migraciones, permisos, pruebas y estado de habilitación: [ALIADOS_PRODUCCION.md](ALIADOS_PRODUCCION.md).

## Cambios de identidad: punto de parada obligatorio

El endpoint `partner-program/register` crea una identidad Auth con
`raw_app_meta_data.account_kind = 'partner'` mediante `auth.admin.createUser`;
el cliente nunca escribe ese metadata. Debe adaptarse `handle_new_user` para
que esa identidad no cree organización, sucursal, owner ni trial. El cambio
afecta una función existente SECURITY DEFINER: presentar el diff y detenerse
antes de aplicarlo. El cambio se reportó antes de aplicar y se comprobó el hash
del cuerpo anterior para abortar ante drift. Todas las funciones propias nuevas
son SECURITY INVOKER.

Implementación productiva: GoTrue aplica app_metadata después de INSERT. Edge
reserva una intención privada (`partner_identity_intents`, nonce/email/expiración
10 minutos) antes de crear la identidad y envía su nonce en user_metadata. El
trigger solo omite tenant si consume una intención válida de ese email; un nonce
inventado/repetido aborta signup. No se confía en un account_kind declarado por
el usuario. La quinta migración y pruebas reproducen el orden real de Auth.

Crear el perfil sin tenant para poder reutilizar Auth, confirmación nativa por
magic link y recuperación de contraseña. Las cuentas existentes owner conservan
su organización y perfil. No aceptar account_kind desde user_metadata ni
permitir que un usuario se asigne rol de plataforma.

## Modelo y restricciones

- `partners`: user_id único FK Auth, nombre, país AR, código normalizado único
  4–20 letras ASCII/dígitos, activo/suspendido, términos/accepted_at, revisión.
  Un owner y un creador comparten esta identidad; inscripción solo con email
  confirmado y owner o account_kind de servidor partner.
- `partner_agreements`: partner, comisión entera 1–100, inicio/fin exclusivo,
  motivo, actor, revisión; impedir acuerdos vigentes superpuestos.
- `partner_instagram_accounts`: provider account_id único por aliado, username,
  followers no negativo entero, verified_at, conexión. Credenciales cifradas en
  tabla separada solo service_role; ningún cliente lee ciphertext.
- `partner_payout_accounts`: titular, CUIT/CUIL y CBU/CVU con revisión y estado
  de verificación. Cambio de datos invalida verificación; impedir cambio durante
  un lote pendiente que usa esa cuenta. Datos completos solo plataforma.
- `partner_referrals`: organization_id único y sucursal_id inicial obligatorios,
  ambos FK y pertenencia conjunta, partner_id, código/términos al registro.
  Inscribir **dentro de la transacción de handle_new_user** a partir del único
  `referral_code` de metadata recibido en signup; validar activo y no autorreferido.
  Código explícito inválido aborta signup, sin crear una cuenta sin beneficio.
  Solo altas tenant nuevas de país AR; comprobar país también en servidor,
  aunque el navegador ya lo valide. Ningún RPC puede atribuir retrospectivamente.
- `partner_checkout_quotes`: referencia a atribución, plan/precio/updated_at del
  catálogo, precio introductorio en centavos, tasa/condiciones del aliado fijadas
  al primer checkout. Reutilizar ese snapshot en reintentos mientras sea vigente;
  cambiar plan/precio invalida la cotización sin reasignar aliado.
- `partner_commissions`: organization_id/sucursal_id de atribución, primer payment_id
  canónico único, tasa histórica, monto, available_at = paid_at + 30 días, estado,
  incidencias/revisión. Unicidad por atribución y primer pago. No fabricar cobros
  para accesos manuales o legacy; solo pagos proveedor validados por billing.
- Libro de ajustes append-only con unicidad por pago/revisión; reversión posterior
  a liquidación genera saldo negativo compensable en el próximo lote. No perder
  ajustes negativos ni pagarlos como una nueva comisión. Reembolso parcial reduce
  proporcionalmente, redondeando por centavo; no reabre descuento consumido.
- Lotes/ítems mensuales: una comisión o ajuste solo puede estar en un lote activo.
  Revisión bloqueante, snapshot de cuenta verificada, neto > 0; saldos <= 0 se
  conservan para compensar futuros ingresos. Ítem paid es terminal; referencia,
  comprobante privado y actor auditados. Preparar lotes hasta cierre de mes anterior
  en America/Argentina/Buenos_Aires con available_at <= cierre.
- `partner_jobs`: outbox durable con dedupe, kind, input, lease/expiry, attempt,
  due_at, error saneado. Renovación tras consumo, reconciliación diaria de pagos,
  liberación a 30 días y verificación Instagram mensual (programar día 25 para
  cumplir frescura <30). Ejecutor cada minuto, lease y límite 25, reintentos
  exponenciales y alerta por tarea vencida; ninguna falla se considera completada.
- OAuth states: hash único, aliado/actor, expiración 10 minutos, consume CAS una
  sola vez. Límites anónimos transaccionales por hash de origen/email y global:
  registro/reenvío 5/h por origen, 3/h por email, 50/h global; código 30/min origen.
- Auditoría y operaciones idempotentes: request_id UUID único por actor y acción,
  fingerprint de input; un retry idéntico recupera el resultado, input distinto
  con mismo ID se rechaza. Nunca guardar contraseñas, tokens o payload proveedor.

Entidades de plataforma no reciben tenants ficticios. Todas las tablas tienen
RLS; tablas tenant solo scope propio, identidades solo user_id propio con DTO
limitado. Escrituras financieras, cron y credenciales exclusivas service_role.
Revocar EXECUTE de comandos privilegiados a PUBLIC/anon/authenticated. Usuarios
del aliado acceden mediante Edge, nunca leen bancos, tenants ajenos o snapshots
de pago. Admin se valida por app_metadata protegido tanto en Edge como en SQL.

## RPC `partner_program_command`

Firma: `_contract_version integer`, `_action text`, `_actor_id uuid nullable`,
`_input jsonb`; retorno JSON no nulo. SECURITY INVOKER, solo service_role.
Todas las acciones admitidas forman whitelist; validar contrato = 1, tipos,
actor Auth vigente, locks y pertenencia; actor_id null solo para acciones worker.
Edge autoriza cada caller antes de invocar. No aceptar decisiones financieras
del navegador. Cada escritura lleva una transacción/revisión propia.

| Acción | Entrada relevante | Salida / invariantes |
|---|---|---|
| readiness | ninguna | `{ready:true}` solo con schema, trigger, RPC, RLS, cron, recepción payment/reversión y outbox probados; false hasta completar checklist |
| public_limit | action, sourceHash, emailHash | `{allowed:boolean}`; hashes, sin IP/email persistido |
| validate_code | code | `{valid:boolean}`; sin partner_id, identidad ni tasa |
| enroll | code, country, termsVersion; actor | inscripción con términos versión 2026-10-14-v1; mismo actor/código idempotente, otro código ALREADY_ENROLLED |
| summary | actor | `{summary:null}` si no adherido; si existe, `PartnerSummary` y `tierInput` del módulo partner-domain; métricas agregadas, comisiones máximo 50 recientes; sin PII tenant/banco |
| save_payout | holder, taxId, account; actor | `{saved:true}`; syntaxis y pertenencia, invalida verificación, alerta por beneficiario repetido |
| prepare_checkout | organizationId, planCode, catalogAmountArs, priceVersion, planUpdatedAt; actor | `{quote:null}` sin atribución o intro consumido; de lo contrario `{quote:{id,amountArs,catalogAmountArs,percent,termsVersion}}`; comprobar owner/permisos billing, catálogo y cotización bajo locks |
| billing_context | eventId, paymentId **o** attributionId | `{context:null}` para evento ignorado/obsoleto/no cohorte; de lo contrario `PartnerBillingContext`; pagos auténticos, primer pago del checkout promocional confirmado, estado/refund canónicos, distinct cycle IDs, revisión, pagos liquidados y ajustes netos ya registrados |
| apply_billing | referencia anterior, revision, effect | validar nuevamente pago y revisión bajo locks; guardar comisión/ajuste/calificación, consumir intro una vez y crear outbox renovación **en la misma transacción**; repetir idéntico no duplica |
| historical_intro_payment | organizationId, authorizedPaymentId, preapprovalId, amountArs, currency | `{accepted:boolean}` solo pago introductorio ya registrado, mismos IDs/referencia/importe/currency; nunca una renovación nueva al precio viejo |
| payment_lookup | providerPaymentId | `{payment:null}` ajeno, o `{payment:{id,providerId,reference,amountArs}}` de cohorte; nunca enlazar pagos POS |
| sync_payment | paymentId, providerPaymentId, status, refundedCents | revisar IDs, actualización de refund/estado; nunca reducir refund confirmado por eventos viejos ni revivir charged_back/refunded por approved tardío |
| claim_jobs | limit<=25 | `{jobs:[{id,lease,kind,input}]}`; SKIP LOCKED, recuperar leases vencidos; kinds payment/ledger/renewal/instagram |
| prepare_renewal | jobId, lease | `{intent:null}` para vínculo ya sustituido/cancelado; de otro modo `{intent:{organizationId,preapprovalId,externalReference}}`; CAS del estado local al precio de catálogo actual, sin sobrescribir un cambio de plan programado; marca durable de transición desde precio promocional. Conservar snapshot histórico del pago y metadatos de coexistencia con cambios de precio |
| complete_job / retry_job | jobId, lease; code para retry | validar lease vigente, completed solo cuando reconciliación GET/PUT/CAS terminó; retry conserva intent y alerta |
| instagram_state / instagram_consume_state | hash; actor al crear | crear nonce para aliado activo; consumir devuelve `{actorId}` verificado |
| instagram_verified | accountId, username, followers, encryptedToken, expiresAt; actor | verified_at de servidor, provider_id único, actualizar métricas y credencial cifrada atómicamente |
| instagram_disconnect | actor | revocar estado y borrar token/nonces inmediatamente |
| instagram_job_credential | jobId,lease | `{accountId,encryptedToken}` solo del job válido/conectado |
| instagram_job_verified | jobId,lease, perfil/credencial | CAS; desconexión concurrente no puede ser revertida por refresh tardío |
| admin_summary | page,pageSize<=50; actor | tipos PartnerAdminSummary en src/types/partners.ts, paginación servidor y límite por colección; nada de datos operativos de clientes |
| admin_payout_details | partnerId; actor | datos de cobro para revisión, revision y verified; exclusivo plataforma |
| admin_operation_status | requestId; actor | `{status:'completed'|'rejected'|'pending'|'not_found', result?}`; solo operaciones del actor |
| admin_agreement | partnerId,revision,percent,startsAt,endsAt,reason,requestId; actor | validación financiera, vigencia, exclusión de superposición, auditoría y CAS |
| admin_verify_payout | partnerId,revision,reason,requestId; actor | verifica revisión de cuenta observada, no la revisión del perfil; duplicados abiertos impiden verificación |
| admin_prepare_payouts | reason,requestId; actor | lote al cierre anterior, disponible/verificado/neto/locks; no repetir inclusión por otra petición |
| admin_mark_paid | payoutId,revision,reference,receiptPath,reason,requestId; actor | verificar snapshot/titularidad/estado/objeto Storage y no incidencias; paid terminal, asiento y auditoría atómicos |
| admin_resolve_incident / admin_suspend | id,revision,reason,requestId; actor | resolución específica/motivo o suspensión; suspensión bloquea nuevos registros, conserva descuentos ya atribuidos y retiene comisiones por revisión |

Errores de negocio SQL: CODE_TAKEN, INVALID_CODE, NOT_OWNER, ALREADY_ENROLLED,
SELF_REFERRAL, REVISION_CONFLICT, PAYOUT_NOT_VERIFIED, ALREADY_PAID,
INVALID_REFERRAL, INCIDENT_OPEN, CAPABILITY_NOT_READY. Registros ausentes no
se convierten en éxito ni se devuelven como arrays sin interpretación.

## RPC `partner_finalize_checkout`

Misma firma/salida que `subscription_finalize_checkout`, añadiendo
`_partner_quote_id uuid` y `_expected_catalog_amount_ars numeric`. Implementar
como transacción invoker exclusiva service_role: comprobar catálogo real con
importe completo/versión/updated_at, bloqueo del quote/atribución, importe 90%
redondeado a centavos, provider/reference/currency, revisión CAS de suscripción;
guardar pending importe promocional y quote relacionado. Cotización invalidada
o catálogo/suscripción que cambió = conflicto 40001; Edge cancela el preapproval.
No rebajar controles actuales ni modificar precios globales de planes.

Propagación de cambios de precio: invalidar checkouts promocionales pendientes
con su quote; el siguiente checkout vuelve a aplicar 10% al catálogo vigente.
Tras intro consumido usar el mismo motor de precio que suscripciones normales,
coordinado con prepare_renewal por revisión. Una notificación tardía del primer
pago validado se admite por historical_intro_payment, sin extender acceso otra vez.

## Storage y habilitación

Bucket privado `partner-payout-receipts`, PDF/JPEG/PNG <=10 MiB. Solo platform_admin
autenticado puede subir/leer objetos. Paths `partner-payouts/<item-id>/<request-id>.<ext>`.
SQL verifica que el path corresponde al ítem, al actor y a un archivo existente.
Tokens Instagram se cifran AES-GCM antes de escribir; clave 32 bytes base64 en
PARTNER_TOKEN_ENCRYPTION_KEY, nunca en VITE ni SQL. Definir rotación de clave
antes de producción: mantener la clave del ciphertext v1 hasta recifrarlo.

Variables servidor (default ausente/false): PARTNER_PROGRAM_ENABLED,
PARTNER_BILLING_ENABLED, PARTNER_INSTAGRAM_ENABLED, PARTNER_INSTAGRAM_VERIFIED;
APP_ORIGIN obligatorio, PARTNER_RATE_LIMIT_SECRET/PARTNER_JOB_SECRET >=32 caracteres.
INSTAGRAM_APP_ID/APP_SECRET/API_VERSION configurados y callback registrado.
Auth allowlist: `<APP_ORIGIN>/aliados/panel` y `/aliados/panel?mode=reset`.
pg_cron invoca worker POST con secret desde almacén seguro, nunca en frontend.
Apagar alta no apaga obligaciones: mantener PARTNER_BILLING_ENABLED para
reconciliar cohortes existentes, renovaciones y liquidaciones.

## Aceptación antes de ready=true

Probar SQL con dos tenants y dos aliados, anon/authenticated/service_role/admin;
signup válido/invalidado concurrentemente, perfiles sin tenant, índices y FK;
quote/catálogo/CAS/checkout concurrentes; duplicados y pago tardío; dos ciclos
distintos sin refund; revocación y reembolso parcial/total posterior a pago;
dos workers/lotes simultáneos, leases vencidos y reinicio; path bancario/Storage
ajeno; aislamiento de tokens; contraejemplos invocando RPC privilegiado como
cliente. Probar Mercado Pago sandbox con primer cobro 90%, segundo 100%, fallo
intermedio PUT/reintento y cambio de plan/precio. Probar Instagram con una cuenta
profesional externa real y conservar evidencia saneada; solo entonces activar
PARTNER_INSTAGRAM_VERIFIED. La sintaxis de CBU/CUIT no demuestra titularidad:
eso se comprueba en la revisión humana de la primera liquidación.
