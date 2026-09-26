BEGIN;

-- Project Auth schreibt ab 2.35 Audit-Ereignisse (Anmeldungen, Fehlversuche,
-- Abmeldungen, Widerrufe der Console) in die Hash-Kette der Plattform. Der
-- Dienst laeuft ueber die Rolle qkern_auth; die hatte bisher kein Recht auf
-- audit_logs.
--
-- Warum genau diese Rechte:
-- * INSERT: der Eintrag selbst. Die Policy audit_logs_insert aus 0002 laesst
--   nur Zeilen der Organisation zu, die die Mandanten-Transaktion in
--   qkern.organization_id gesetzt hat.
-- * SELECT: aus drei Gruenden noetig, nicht aus Bequemlichkeit. Der Trigger
--   qkern_prepare_audit_log laeuft als SECURITY INVOKER und liest mit den
--   Rechten des Aufrufers den letzten entry_hash der Organisation, um die
--   Kette fortzusetzen; ohne SELECT scheitert jeder INSERT. Das RETURNING in
--   AuditRepository.append braucht es ebenfalls. Und die Console liest den
--   Auth-Auszug ueber denselben Dienst. Die Policy audit_logs_select aus 0002
--   begrenzt das Lesen auf die eigene Organisation.
-- * EXECUTE auf die drei Funktionen der Kette: wie bei qkern_runtime,
--   qkern_worker und qkern_provisioner ausdruecklich vergeben, auch wenn
--   PUBLIC sie heute noch ausfuehren darf. So bleibt der Weg offen, falls
--   PUBLIC sie spaeter verliert.
-- Kein UPDATE, kein DELETE: audit_logs bleibt append-only, der Trigger
-- qkern_reject_audit_mutation wuerde beides ohnehin ablehnen.
GRANT SELECT, INSERT ON audit_logs TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_current_organization_id() TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_prepare_audit_log() TO qkern_auth;
GRANT EXECUTE ON FUNCTION qkern_reject_audit_mutation() TO qkern_auth;

-- Die Auth-Rolle haengt nur eigene Aktionen an. Ohne diese Grenze koennte
-- ein kompromittierter Auth-Dienst fremde Plattform-Geschichte in die Kette
-- schreiben, etwa Change-Set-, Freigabe- oder Deployment-Eintraege, und sie
-- saehen aus wie echte. RESTRICTIVE wird mit der permissiven Policy
-- audit_logs_insert aus 0002 verknuepft (beide muessen gelten), die
-- Organisationsgrenze bleibt also bestehen. Die Policy nennt die
-- Gruppenrolle qkern_auth; die Login-Rolle qkern_auth_app ist Mitglied mit
-- INHERIT und faellt damit darunter. Die SELECT-Policy bleibt bewusst weit:
-- Der Trigger der Kette muss den neuesten Hash der ganzen Organisation lesen,
-- sonst verzweigte die Kette.
CREATE POLICY audit_logs_project_auth_insert ON audit_logs AS RESTRICTIVE
  FOR INSERT TO qkern_auth WITH CHECK (starts_with(action, 'project_auth.'));

COMMIT;
