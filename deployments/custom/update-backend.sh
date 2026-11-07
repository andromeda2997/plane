#!/bin/bash
# Aktualisiert das eigene Plane-Backend (api, worker, beat-worker, migrator), wenn das
# Image hinter dem Tag aus docker-compose.override.yml neu ist.
#
# Ablauf bei neuem Image:
#   1. laufendes Image als plane-backend:previous taggen (fuer den Rollback)
#   2. Datenbank-Dump (vorhandenes Backup-Skript; bei Fehler Abbruch, nichts geaendert)
#   3. migrator einmalig laufen lassen (docker compose run), Exit-Code muss 0 sein
#   4. api, worker, beat-worker mit dem neuen Image neu erstellen
#   5. /api/instances/ im api-Container pruefen, worker/beat-worker muessen laufen
# Schlaegt 3. oder 5. fehl, wird das Image als "fehlgeschlagen" markiert: weitere Laeufe
# brechen mit Meldung ab, bis ein neueres Image kommt oder die Markierung geloescht wird.
#
# Aufruf:  update-backend.sh           pruefen und ggf. aktualisieren
#          update-backend.sh --check   nur pullen und anzeigen, ob ein Update anstuende
#
# Einstellungen per Umgebung (Standardwerte passen zum offiziellen Plane-Setup):
#   PLANE_DIR, PLANE_ENV_FILE, PLANE_PROJECT, PLANE_BACKUP_SCRIPT, PLANE_STATE_DIR,
#   PLANE_LOCK_FILE, HEALTH_TIMEOUT (Sekunden)
#
# Hinweis: "docker compose config" enthaelt Passwoerter. Die Ausgabe wird nur intern
# ausgewertet und nie ins Log geschrieben; deshalb hier auch kein "set -x".
set -euo pipefail

PLANE_DIR=${PLANE_DIR:-/opt/plane}
PLANE_ENV_FILE=${PLANE_ENV_FILE:-plane.env}
PLANE_PROJECT=${PLANE_PROJECT:-plane-app}
PLANE_BACKUP_SCRIPT=${PLANE_BACKUP_SCRIPT:-$PLANE_DIR/backup/pg_dump.sh}
PLANE_STATE_DIR=${PLANE_STATE_DIR:-$PLANE_DIR/state}
PLANE_LOCK_FILE=${PLANE_LOCK_FILE:-/run/lock/plane-update.lock}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-300}

BACKEND_SERVICES=(api worker beat-worker migrator)
RUN_SERVICES=(api worker beat-worker)
PREVIOUS_TAG=plane-backend:previous
FAILED_FILE=$PLANE_STATE_DIR/backend-update.failed
LAST_FILE=$PLANE_STATE_DIR/backend-update.last

CHECK_ONLY=0
case "${1:-}" in
  "") ;;
  --check) CHECK_ONLY=1 ;;
  *) echo "Aufruf: $0 [--check]" >&2; exit 2 ;;
esac

log() { echo "[update-backend] $*"; }
die() { echo "[update-backend] FEHLER: $*" >&2; exit 1; }

cd "$PLANE_DIR" || die "Verzeichnis $PLANE_DIR fehlt"
[ -f "$PLANE_ENV_FILE" ] || die "$PLANE_DIR/$PLANE_ENV_FILE fehlt"
DC=(docker compose --env-file "$PLANE_ENV_FILE" -p "$PLANE_PROJECT")

# Nur ein Update gleichzeitig (gleiche Lock-Datei auch fuer update-web.sh verwenden).
exec 9>"$PLANE_LOCK_FILE"
flock -w 900 9 || die "Lock $PLANE_LOCK_FILE nach 15 min nicht frei (laeuft ein anderes Update?)"

mkdir -p "$PLANE_STATE_DIR"

# Image eines Dienstes aus der aufgeloesten Compose-Konfiguration lesen.
# Bewusst NICHT "config --images <dienst>": das listet unter neueren Compose-Versionen
# alle Images. Fehlermeldungen von compose bleiben sichtbar (stderr), die Ausgabe selbst
# (mit Passwoertern) nur in der Variablen.
service_image() {
  local svc=$1 cfg img
  if command -v python3 >/dev/null; then
    cfg=$("${DC[@]}" config --format json "$svc") || die "docker compose config $svc fehlgeschlagen"
    img=$(python3 -c 'import json, sys
svc = sys.argv[1]
print(json.load(sys.stdin).get("services", {}).get(svc, {}).get("image", ""))' "$svc" <<<"$cfg") \
      || die "Konnte die Konfiguration von $svc nicht auswerten"
  else
    cfg=$("${DC[@]}" config "$svc") || die "docker compose config $svc fehlgeschlagen"
    img=$(awk -v hdr="  $svc:" '$0 == hdr {f = 1; next} f && /^  [^ ]/ {exit} f && /^    image: / {print $2; exit}' <<<"$cfg")
  fi
  [ -n "$img" ] || die "Kein Image fuer Dienst $svc gefunden"
  printf '%s\n' "$img"
}

# Image-ID des laufenden Containers eines Dienstes (oder "none").
running_image_id() {
  local cid
  cid=$("${DC[@]}" ps -q "$1" | head -n 1)
  if [ -n "$cid" ]; then docker inspect -f '{{.Image}}' "$cid"; else echo none; fi
}

container_of() { "${DC[@]}" ps -q "$1" | head -n 1; }

# --- 1. Ziel-Image ermitteln (alle vier Dienste muessen dasselbe nutzen) ---------------
IMG=""
for svc in "${BACKEND_SERVICES[@]}"; do
  i=$(service_image "$svc")
  if [ -z "$IMG" ]; then
    IMG=$i
  elif [ "$i" != "$IMG" ]; then
    die "Dienste nutzen verschiedene Images ($IMG vs. $svc=$i) - docker-compose.override.yml pruefen"
  fi
done

# --- 2. Pullen (nur bei Registry-Images; lokale Tags wie plane-backend:previous nicht) --
case "${IMG%%:*}" in
  */*) "${DC[@]}" pull --quiet api || die "Pull von $IMG fehlgeschlagen" ;;
  *) log "Lokales Image $IMG, kein Pull" ;;
esac
NEW=$(docker image inspect -f '{{.Id}}' "$IMG") || die "Image $IMG ist lokal nicht vorhanden"

# --- 3. Markierung eines frueher fehlgeschlagenen Updates beachten ---------------------
if [ -f "$FAILED_FILE" ]; then
  failed_id=$(head -n 1 "$FAILED_FILE")
  if [ "$failed_id" = "$NEW" ]; then
    die "Update auf $IMG ($NEW) ist bereits fehlgeschlagen (siehe $FAILED_FILE). Ursache beheben bzw. zurueckrollen (README), dann $FAILED_FILE loeschen."
  fi
  log "Neueres Image als das fehlgeschlagene ($failed_id) - neuer Versuch"
fi

# --- 4. Laeuft schon alles mit dem neuen Image? -----------------------------------------
RUNNING=$(running_image_id api)
uptodate=1
for svc in "${RUN_SERVICES[@]}"; do
  [ "$(running_image_id "$svc")" = "$NEW" ] || uptodate=0
done
if [ "$uptodate" = 1 ]; then
  [ "$CHECK_ONLY" = 1 ] && log "Aktuell: $IMG ($NEW)"
  exit 0
fi

log "Neues Backend-Image $IMG ($NEW), api laeuft bisher mit $RUNNING"
if [ "$CHECK_ONLY" = 1 ]; then
  log "--check: Update wuerde jetzt ausgefuehrt (Dump, migrator, api/worker/beat-worker)"
  exit 0
fi

mark_failed() {
  printf '%s\n%s\n%s\n' "$NEW" "$IMG" "$(date -Is) $1" > "$FAILED_FILE"
  echo "[update-backend] FEHLER: $1" >&2
  echo "[update-backend] Rollback: README (deployments/custom/README.md im Fork), Abschnitt 'Rollback'." >&2
  echo "[update-backend]   Vorheriges Image: $PREVIOUS_TAG ($prev_ref), Dump: ${DUMP:-keiner}" >&2
  echo "[update-backend]   Weitere Laeufe brechen ab, bis $FAILED_FILE geloescht ist oder ein neueres Image kommt." >&2
  exit 1
}

# --- 5. Vorheriges Image sichern -------------------------------------------------------
prev_ref=none
if [ "$RUNNING" != none ] && [ "$RUNNING" != "$NEW" ]; then
  prev_ref=$(docker inspect -f '{{.Config.Image}}' "$(container_of api)")
  docker tag "$RUNNING" "$PREVIOUS_TAG"
  log "Bisheriges Image $prev_ref ($RUNNING) als $PREVIOUS_TAG getaggt"
fi

# --- 6. Datenbank-Dump (Pflicht) ------------------------------------------------------
[ -x "$PLANE_BACKUP_SCRIPT" ] || die "Backup-Skript $PLANE_BACKUP_SCRIPT fehlt oder ist nicht ausfuehrbar - kein Update ohne Dump"
log "Datenbank-Dump: $PLANE_BACKUP_SCRIPT"
dump_out=$("$PLANE_BACKUP_SCRIPT") || die "Dump fehlgeschlagen - Update abgebrochen, nichts geaendert"
printf '%s\n' "$dump_out"
DUMP=$(sed -n 's/^OK: \([^ ]*\).*/\1/p' <<<"$dump_out" | tail -n 1)
DUMP=${DUMP:-"(siehe Ausgabe des Backup-Skripts)"}

printf 'zeit=%s\nneu=%s %s\nvorher=%s %s\ndump=%s\n' "$(date -Is)" "$IMG" "$NEW" "$prev_ref" "$RUNNING" "$DUMP" > "$LAST_FILE"

# --- 7. Migrationen -------------------------------------------------------------------
log "Migrationen (migrator) mit $IMG ..."
set +e
"${DC[@]}" run --rm -T --no-deps migrator
rc=$?
set -e
[ "$rc" -eq 0 ] || mark_failed "migrator endete mit Exit-Code $rc. api/worker/beat-worker laufen noch mit dem alten Image; das Schema kann teilweise migriert sein."
log "Migrationen ok"

# --- 8. Dienste neu erstellen ---------------------------------------------------------
"${DC[@]}" up -d --no-deps "${RUN_SERVICES[@]}" || mark_failed "docker compose up fuer ${RUN_SERVICES[*]} fehlgeschlagen"

# --- 9. Gesundheit pruefen ------------------------------------------------------------
# api hat im offiziellen Compose keinen Healthcheck und keinen veroeffentlichten Port:
# daher HTTP-Abfrage im Container. Der Start (register_instance, collectstatic ...) dauert.
log "Warte auf /api/instances/ (max. ${HEALTH_TIMEOUT}s) ..."
probe='import os, sys, urllib.request
url = "http://127.0.0.1:%s/api/instances/" % os.environ.get("PORT", "8000")
with urllib.request.urlopen(url, timeout=5) as r:
    sys.exit(0 if r.status == 200 else 1)'
deadline=$((SECONDS + HEALTH_TIMEOUT))
api_ok=0
last_err=""
while [ "$SECONDS" -lt "$deadline" ]; do
  if last_err=$("${DC[@]}" exec -T api python -c "$probe" 2>&1); then
    api_ok=1
    break
  fi
  sleep 5
done
if [ "$api_ok" != 1 ]; then
  [ -n "$last_err" ] && printf '%s\n' "$last_err" | tail -n 3 >&2
  mark_failed "api beantwortet /api/instances/ nach ${HEALTH_TIMEOUT}s nicht. Logs: docker compose --env-file $PLANE_ENV_FILE -p $PLANE_PROJECT logs --tail 100 api"
fi
log "api antwortet"

sleep 20
for svc in worker beat-worker; do
  cid=$(container_of "$svc")
  [ -n "$cid" ] || mark_failed "$svc laeuft nicht"
  read -r running restarts img_id < <(docker inspect -f '{{.State.Running}} {{.RestartCount}} {{.Image}}' "$cid")
  [ "$running" = true ] && [ "$restarts" = 0 ] && [ "$img_id" = "$NEW" ] \
    || mark_failed "$svc nicht stabil (running=$running, restarts=$restarts). Logs: docker compose --env-file $PLANE_ENV_FILE -p $PLANE_PROJECT logs --tail 100 $svc"
done

rm -f "$FAILED_FILE"
docker image prune -f >/dev/null
log "OK: Backend laeuft mit $IMG ($NEW); vorheriges Image: $PREVIOUS_TAG ($prev_ref); Dump: $DUMP"
