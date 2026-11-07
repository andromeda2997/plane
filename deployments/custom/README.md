# Eigenes Backend ausrollen (Fork-Pipeline)

Bausteine, mit denen das angepasste Plane-Backend (`apps/api`) aus diesem Fork gebaut und auf einem
Server mit dem offiziellen Plane-Compose-Setup ausgerollt wird. Für das Frontend gibt es das gleiche
Verfahren schon (`.github/workflows/custom-frontend.yml`, Dienst `web`).

| Datei                                          | Zweck                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `../../.github/workflows/custom-backend.yml`   | CI: baut `apps/api/Dockerfile.api` und pusht `ghcr.io/andromeda2997/plane-backend`             |
| `docker-compose.override.yml`                  | Vorlage für die **eine** Override-Datei auf dem Server (web + api/worker/beat-worker/migrator) |
| `update-backend.sh`                            | Pull → Dump → migrator → api/worker/beat-worker → Gesundheitsprüfung                           |
| `systemd/plane-backend-update.{service,timer}` | Timer-Vorlage (alle 15 Minuten)                                                                |
| `docker-compose.local-backend.yml`             | Laptop-Test-Stack: lokal gebautes Backend-Image einsetzen                                      |

Platzhalter in dieser Anleitung: `<PLANE_DIR>` = Verzeichnis des Plane-Stacks auf dem Server (dort
liegen `docker-compose.yml`, `plane.env` und das Backup-Skript, z. B. `/opt/plane`), `<STACK_DIR>` =
Verzeichnis des Laptop-Test-Stacks (aus `setup.sh`, mit `docker-compose.yaml` und `plane.env`).

## Images und Tags

Bei jedem Push auf einen Zweig `custom/vX.Y.Z`, der `apps/api/**` oder die Workflow-Datei ändert
(oder per „Run workflow“ / `workflow_dispatch`), entstehen:

- `ghcr.io/andromeda2997/plane-backend:vX.Y.Z-custom.<lauf>` – fester Tag pro Build (für Rollbacks)
- `ghcr.io/andromeda2997/plane-backend:vX.Y.Z-custom` – beweglicher Tag, zeigt immer auf den letzten Build
- `ghcr.io/andromeda2997/plane-backend:sha-<kurz>` – Commit-Bezug

Ein Image für alle vier Backend-Dienste (`api`, `worker`, `beat-worker`, `migrator`); sie
unterscheiden sich nur im `command` aus dem offiziellen Compose. Plattform: `linux/amd64`. Das
Dockerfile braucht keine Build-Args (`APK_SECURITY_PATCH` hat einen Standardwert).

**Nach dem ersten Build:** Unter GitHub → Packages → `plane-backend` die Sichtbarkeit prüfen. Neue
Pakete sind oft privat; dann braucht der Server ein `docker login ghcr.io` (Token mit
`read:packages`) oder das Paket wird – wie das Frontend-Paket – öffentlich gestellt.

## Erstinstallation auf dem Server

Voraussetzungen: offizielles Plane-Setup in `<PLANE_DIR>`, Aufruf **ohne** `-f`
(`docker compose --env-file plane.env -p plane-app …`), damit Compose die
`docker-compose.override.yml` automatisch dazulädt; `python3` und `flock` vorhanden; ein
Backup-Skript, das bei Fehlern mit Exit ≠ 0 endet und bei Erfolg `OK: <pfad-zum-dump>` ausgibt
(Standardpfad `<PLANE_DIR>/backup/pg_dump.sh`, per `PLANE_BACKUP_SCRIPT` änderbar).

1. Ersten CI-Build abwarten (siehe oben, Sichtbarkeit des Pakets prüfen).
2. Bestehende Override-Datei sichern und durch die Vorlage ersetzen (sie enthält weiterhin `web`).
   Es darf nur **eine** `docker-compose.override.yml` geben – eine zweite Datei mit anderem Namen
   würde ohne `-f` nicht geladen.

   ```bash
   cd <PLANE_DIR>
   cp docker-compose.override.yml docker-compose.override.yml.bak-$(date +%Y%m%d)
   install -m 644 <repo>/deployments/custom/docker-compose.override.yml docker-compose.override.yml
   docker compose --env-file plane.env -p plane-app config --format json api >/dev/null   # Syntax ok?
   ```

   Achtung: `docker compose config` ohne Umleitung gibt Passwörter aus.

3. Skript installieren und trocken testen:

   ```bash
   install -m 755 <repo>/deployments/custom/update-backend.sh <PLANE_DIR>/bin/update-backend.sh
   <PLANE_DIR>/bin/update-backend.sh --check
   ```

   `--check` pullt das Image und meldet, ob ein Update anstünde – es ändert sonst nichts.

4. Erste Umstellung (offizielles → eigenes Backend) **von Hand** ausführen und beobachten:

   ```bash
   <PLANE_DIR>/bin/update-backend.sh
   ```

   Das läuft wie jedes spätere Update: laufendes Image als `plane-backend:previous` taggen, Dump,
   `migrator`, `api`/`worker`/`beat-worker` neu erstellen, `/api/instances/` prüfen.

5. Timer einrichten (Pfade in der Service-Datei ggf. anpassen):

   ```bash
   install -m 644 <repo>/deployments/custom/systemd/plane-backend-update.service /etc/systemd/system/
   install -m 644 <repo>/deployments/custom/systemd/plane-backend-update.timer /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now plane-backend-update.timer
   systemctl list-timers 'plane-*'
   ```

6. Empfohlen: das Frontend-Update-Skript nutzt dieselbe Lock-Datei, damit Frontend- und
   Backend-Update nie gleichzeitig laufen. Entweder im Skript
   (`exec 9>/run/lock/plane-update.lock; flock -w 900 9`) oder in dessen Service-Unit
   `ExecStart=/usr/bin/flock -w 900 /run/lock/plane-update.lock <PLANE_DIR>/bin/update-web.sh`.

## Betrieb

- Protokoll: `journalctl -u plane-backend-update.service -n 100`
- Zustandsdateien in `<PLANE_DIR>/state/`:
  - `backend-update.last` – letztes Update: neues/vorheriges Image, Pfad des Dumps
  - `backend-update.failed` – existiert nach einem fehlgeschlagenen Update (migrator ≠ 0, api
    antwortet nicht, worker/beat-worker instabil). Solange das gepullte Image dasselbe ist, bricht
    jeder Lauf mit Fehlermeldung ab (kein Dump-Spam, kein stilles „alles aktuell“). Ein neuerer
    CI-Build wird automatisch wieder versucht; sonst nach Behebung/Rollback die Datei löschen.
- Wie das Skript das Image ermittelt: `docker compose config --format json <dienst>` (bzw. YAML,
  falls kein `python3`) und daraus `services.<dienst>.image` – nicht `config --images <dienst>`,
  das listet unter neueren Compose-Versionen alle Images. Alle vier Backend-Dienste müssen dasselbe
  Image haben, sonst bricht das Skript ab.
- Lokale Tags ohne Registry (z. B. `plane-backend:previous`) werden nicht gepullt; damit kann der
  Timer auch nach einem Rollback auf das lokale Image weiterlaufen.

## Rollback

**Wichtig:** Django-Migrationen werden beim Zurückwechseln des Images **nicht** automatisch
rückgängig gemacht – das alte Image kennt die neuen Migrationen gar nicht. Ein Rollback mit
Schemaänderungen heißt daher: **Dump zurückspielen**. Den passenden Dump nennt die Fehlermeldung
bzw. `<PLANE_DIR>/state/backend-update.last` (er wurde direkt vor dem Update erstellt). Daten, die
seit dem Dump angelegt wurden, gehen dabei verloren.

```bash
cd <PLANE_DIR>
DC="docker compose --env-file plane.env -p plane-app"
systemctl disable --now plane-backend-update.timer        # sonst kommt das neue Image zurück
```

1. **Image zurückstellen.** In `docker-compose.override.yml` bei `x-custom-backend-image` einen
   festen, ziehbaren Tag eintragen (bevorzugt), z. B. `ghcr.io/andromeda2997/plane-backend:v1.4.3-custom.<lauf>`
   oder das offizielle `makeplane/plane-backend:v1.4.3` – oder das lokal gesicherte
   `plane-backend:previous`.
2. **Nur wenn das fehlerhafte Update Migrationen eingespielt hat** (Normalfall bei neuen
   Erweiterungen; im Zweifel ja): Backend stoppen, Schema leeren, Dump einspielen.

   ```bash
   $DC stop api worker beat-worker
   $DC exec -T plane-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
   gunzip -c backup/dumps/plane-<zeitstempel>.sql.gz \
     | $DC exec -T plane-db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

   Das Schema wird vorher geleert, weil `--clean` im Dump nur Objekte entfernt, die im Dump
   vorkommen: Tabellen neuer Erweiterungen blieben sonst liegen, während `django_migrations` sie als
   „nicht angewendet“ führt – das nächste Update scheiterte dann an „relation already exists“.
   Das Zurückspielen einmal auf dem Laptop-Test-Stack üben, bevor man es braucht.

3. **Starten und prüfen:**

   ```bash
   $DC run --rm -T --no-deps migrator                  # mit dem alten Image: sollte nichts zu tun haben
   $DC up -d --no-deps api worker beat-worker
   $DC exec -T api python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/api/instances/").status)'
   rm -f state/backend-update.failed
   ```

4. Timer erst wieder einschalten, wenn der bewegliche Tag in der Override-Datei steht **und** ein
   reparierter Build in GHCR liegt (`systemctl enable --now plane-backend-update.timer`).

Alternative ohne Dump, nur für eigene Erweiterungen, deren Migrationen rückwärts sauber sind: **vor**
dem Image-Wechsel mit dem neuen Image `$DC run --rm -T --no-deps migrator python manage.py migrate <app_label> <vorherige_migration|zero>`
ausführen. Das entfernt nur die Schemaänderungen dieser App.

Zurück zum komplett offiziellen Backend: die vier Backend-Dienste aus der Override-Datei entfernen
(oder `makeplane/plane-backend:<version>` eintragen), Timer deaktivieren, Schritte 2–3.

## Plane-Updates (neue Upstream-Version)

1. Upstream-Tag in einen neuen Zweig `custom/vX.Y.Z` übernehmen (Merge/Rebase der eigenen Commits).
   Konflikte entstehen vor allem dort, wo eigene Apps registriert werden (siehe Konvention unten).
2. CI baut `plane-backend:vX.Y.Z-custom` und `plane-frontend:vX.Y.Z-custom`.
3. Auf dem Server: `APP_RELEASE` in `plane.env` (für proxy, space, admin, live) und beide Tags in der
   Override-Datei auf `vX.Y.Z-custom` setzen, dann das offizielle Upgrade-Verfahren bzw.
   `update-backend.sh` ausführen. `setup.sh upgrade` ersetzt `docker-compose.yml`, die Override-Datei
   bleibt erhalten.
4. Bis die neuen Tags gebaut sind, zieht der Timer weiter den alten Tag – Server und Zweig dürfen
   nicht auseinanderlaufen (Override-Tag immer passend zum Zweig wählen).

Risiken: Upstream-Migrationen und eigene Migrationen laufen gemeinsam durch den `migrator`; eigene
Migrationen hängen von Upstream-Migrationen ab (`dependencies`) und müssen nach einem Upstream-Update
weiter passen. Ein ganzer Versionssprung ist nur über den Dump umkehrbar.

## Laptop: lokal gebautes Backend testen

Ziel: ein Backend-Image aus einem Worktree des Forks im Laptop-Test-Stack (`setup.sh`-Installation,
Projekt `plane-app`) einsetzen, **ohne** `docker-compose.yaml` zu ändern (das überschreibt
`setup.sh upgrade`). Alle Befehle sind Beispiele; Docker-Rechte (Gruppe `docker` oder `sudo`)
vorausgesetzt.

```bash
# 1. Image bauen (im Worktree, ~3 min ohne Cache)
cd <worktree>
docker build -f apps/api/Dockerfile.api -t plane-backend:dev apps/api

# 2. Override einmalig in den Stack kopieren (setzt api/worker/beat-worker/migrator auf
#    plane-backend:dev, pull_policy: never)
cp deployments/custom/docker-compose.local-backend.yml <STACK_DIR>/

# 3. Vorher sichern (Migrationen eigener Apps sind nur so sicher umkehrbar)
cd <STACK_DIR>
DC="docker compose -p plane-app --env-file plane.env -f docker-compose.yaml -f docker-compose.local-backend.yml"
$DC exec -T plane-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --clean --if-exists' | gzip > ~/plane-laptop-$(date +%Y%m%d-%H%M%S).sql.gz

# 4. Migrationen, dann Dienste
$DC run --rm -T --no-deps migrator          # Exit-Code 0?
$DC up -d --no-deps api worker beat-worker
curl -fsS http://127.0.0.1/api/instances/ >/dev/null && echo ok   # über den Proxy des Stacks
```

- `--no-deps` mit expliziten Diensten lässt `web` unangetastet – auch ein laufender
  Frontend-Dev-Server (`docker-compose.dev.yaml`) bleibt. Wer den ganzen Stack mit `up -d` startet,
  muss **alle** Override-Dateien angeben (`-f docker-compose.yaml -f docker-compose.dev.yaml -f docker-compose.local-backend.yml`).
- Neuer Code: Schritt 1 und 4 wiederholen.
- Zurück zum offiziellen Backend:
  `docker compose -p plane-app --env-file plane.env -f docker-compose.yaml up -d --no-deps api worker beat-worker`.
  Auch `setup.sh start/restart/upgrade` und die Frontend-Dev-Skripte kennen die Backend-Override nicht
  und stellen beim nächsten `up` das offizielle Backend her. Tabellen eigener Apps bleiben dann in der
  Datenbank (stört das offizielle Backend nicht, `wait_for_migrations` prüft nur bekannte
  Migrationen), die Funktionen fehlen aber. Sauber zurück: Dump aus Schritt 3 wie im Abschnitt
  „Rollback“ einspielen.

## Konvention für Backend-Erweiterungen

Eigene Funktionen kommen als **eigene Django-Apps** unter `apps/api/plane/ext/<name>/` – nicht in
die Upstream-Apps (`plane.db`, `plane.app`, …). So bleiben Upstream-Merges konfliktarm und die
Migrationsnummern von Upstream und Fork kommen sich nicht in die Quere.

```text
apps/api/plane/ext/
├── __init__.py                 # leer, macht plane.ext zum Paket (Pflicht)
├── urls.py                     # sammelt die URLs aller Erweiterungen
├── schedules.py                # optional: Beat-Einträge aller Erweiterungen
└── <name>/
    ├── __init__.py
    ├── apps.py                 # AppConfig mit festem label
    ├── models.py
    ├── migrations/
    │   └── __init__.py
    ├── serializers.py
    ├── views.py
    ├── urls.py
    └── tasks.py                # Celery-Tasks (werden automatisch gefunden)
```

### App und Label

```python
# apps/api/plane/ext/recurring/apps.py
from django.apps import AppConfig


class RecurringConfig(AppConfig):
    name = "plane.ext.recurring"
    label = "ext_recurring"  # eindeutig, NIE mehr ändern: Migrationen und Tabellennamen hängen daran
```

Ohne explizites `label` nimmt Django den letzten Namensteil (`recurring`) – Kollisionsgefahr mit
Upstream oder Drittpaketen. Modelle erben in der Regel von den Plane-Basisklassen
(`plane.db.models.base.BaseModel`, `WorkspaceBaseModel` in `plane/db/models/workspace.py`,
`ProjectBaseModel` in `plane/db/models/project.py`: UUID-Primärschlüssel, Audit-Felder,
Soft-Delete).

### Registrierung in `INSTALLED_APPS`

`apps/api/plane/settings/common.py`, Liste `INSTALLED_APPS` (Abschnitt `# Inhouse apps`, nach
`"plane.authentication"`). Ein eigener Kommentarblock hält den Merge-Konflikt klein:

```python
    "plane.api",
    "plane.authentication",
    # Fork-Erweiterungen (plane/ext)
    "plane.ext.recurring",
    "plane.ext.wiki",
    # Third-party things
```

### URLs

`apps/api/plane/urls.py`, Liste `urlpatterns`: **eine** Zeile nach `path("api/v1/", …)` und vor dem
Sammel-Eintrag `path("", include("plane.web.urls"))`:

```python
    path("api/v1/", include("plane.api.urls")),
    path("api/", include("plane.ext.urls")),  # Fork-Erweiterungen
    path("auth/", include("plane.authentication.urls")),
```

```python
# apps/api/plane/ext/urls.py
from django.urls import include, path

urlpatterns = [
    path("", include("plane.ext.recurring.urls")),
    path("", include("plane.ext.wiki.urls")),
]
```

- Eigene Endpunkte müssen unter `/api/` liegen: der Proxy (`apps/proxy/Caddyfile.ce`) leitet nur
  `/api/*`, `/auth/*` und `/static/*` an den `api`-Dienst weiter, alles andere geht ans Frontend.
- Django prüft die Muster der Reihe nach; `plane.app.urls` (ebenfalls unter `api/`, zusammengesetzt
  in `apps/api/plane/app/urls/__init__.py`) kommt zuerst. Pfade so wählen, dass sie keine
  Upstream-Route überdecken oder von ihr verdeckt werden, z. B.
  `workspaces/<str:slug>/projects/<uuid:project_id>/recurring-work-items/`. URL-Namen mit Präfix
  (`ext-recurring-…`).
- Views wie Upstream: `plane.app.views.base.BaseAPIView`/`BaseViewSet`, Rechte über
  `plane.app.permissions.allow_permission` und `ROLE`.

### Migrationen

```bash
# im Dev-Container bzw. mit lokaler Python-Umgebung in apps/api
python manage.py makemigrations ext_recurring
python manage.py makemigrations --check --dry-run   # vor jedem Commit: nichts vergessen?
```

- Migrationen liegen in `plane/ext/<name>/migrations/` und werden mit committet. Angewendete
  Migrationen nie nachträglich ändern – neue Migration schreiben.
- Fremdschlüssel auf Plane-Modelle erzeugen eine Abhängigkeit auf die jeweils neueste
  `("db", "0…")`-Migration; das ist gewollt.
- Wenn möglich umkehrbar halten (`RunPython` mit `reverse_code`), dann ist ein Rollback einer
  einzelnen App per `migrate <label> zero` möglich (siehe „Rollback“).
- Upstream-Tabellen nicht verändern (keine `AddField` auf `plane.db`-Modelle) – eigene Tabellen mit
  Fremdschlüssel/1:1-Beziehung verwenden.
- Ausgerollt werden sie vom Dienst `migrator` (`bin/docker-entrypoint-migrator.sh` →
  `manage.py migrate`); `api`, `worker` und `beat-worker` warten per `wait_for_migrations`, bis
  nichts mehr offen ist.

### Celery-Tasks und Beat-Zeitplan

- Tasks in `plane/ext/<name>/tasks.py` mit `@shared_task`. `apps/api/plane/celery.py` ruft
  `app.autodiscover_tasks()` auf und findet `tasks.py` aller Apps in `INSTALLED_APPS` – ein Eintrag
  in `CELERY_IMPORTS` (`apps/api/plane/settings/common.py`) ist nicht nötig.
- Den Zeitplan definiert Plane in `apps/api/plane/celery.py` als `app.conf.beat_schedule = {…}`.
  Statt dieses Dict zu bearbeiten, direkt **danach** eine Zeile ergänzen:

  ```python
  # apps/api/plane/celery.py, nach dem beat_schedule-Dict
  from plane.ext.schedules import EXT_BEAT_SCHEDULE  # noqa: E402

  app.conf.beat_schedule.update(EXT_BEAT_SCHEDULE)
  ```

  ```python
  # apps/api/plane/ext/schedules.py – nur Daten, keine Modelle importieren
  from celery.schedules import crontab

  EXT_BEAT_SCHEDULE = {
      "ext-recurring-create-work-items": {
          "task": "plane.ext.recurring.tasks.create_recurring_work_items",
          "schedule": crontab(minute="*/15"),
      },
  }
  ```

- Zeitzone ist UTC (`TIME_ZONE`/`CELERY_TIMEZONE` in `common.py`).
- Plane nutzt `django_celery_beat.schedulers.DatabaseScheduler`: Beat überträgt die Einträge beim
  Start in die Tabelle `django_celery_beat_periodictask`. Umbenannte oder entfernte Einträge bleiben
  dort stehen und müssen per Django-Shell gelöscht werden.
- Nach einem Deploy laufen neue Tasks erst, wenn `worker` **und** `beat-worker` mit dem neuen Image
  laufen (macht `update-backend.sh`).

### Tests

- Testsuite: `docker-compose-test.yml` im Repo-Wurzelverzeichnis, Anleitung in
  `apps/api/tests/RUNNING_TESTS.md` (vorher einmal `./setup.sh` für `apps/api/.env`).
- Tests für Erweiterungen unter `apps/api/plane/tests/ext/<name>/test_*.py` (mit `__init__.py`),
  damit die Fixtures aus `apps/api/plane/tests/conftest.py` (`api_client`, `session_client`,
  `workspace`, …) greifen. Marker (`unit`, `contract`, `smoke`, `slow`) aus `apps/api/pytest.ini`
  verwenden (`--strict-markers`).

  ```bash
  docker compose -f docker-compose-test.yml run --rm --build api-tests pytest plane/tests/ext/recurring -vv
  docker compose -f docker-compose-test.yml down -v
  ```

- `pytest.ini` setzt `--nomigrations`: die Tests legen Tabellen direkt aus den Modellen an,
  **Migrationen werden dort nicht geprüft**. Deshalb zusätzlich `makemigrations --check` und einen
  echten `migrator`-Lauf auf dem Laptop-Test-Stack (siehe oben).
