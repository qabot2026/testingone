# Load testing with Locust

This folder hits the deployed `contact-form-api` (Railway) so you can see how
many concurrent visitors the Dialogflow CX webhook and helper REST endpoints
can handle.

The bulk of the traffic targets the **`get_nearby_branches`** webhook tag —
that's the newest code path (haversine sort over the branch catalog with
backfill from the bundled JSON) and the one most likely to surface a
regression under load.

## Files

- `locustfile.py` — task definitions (chat webhook + REST helpers).
- `requirements.txt` — pin for Locust.

## One-time setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r loadtest\requirements.txt
```

## Run with the web UI (recommended first time)

```powershell
locust -f loadtest\locustfile.py --host https://<your-railway-app>.up.railway.app
```

Then open [http://localhost:8089](http://localhost:8089), set the number of
users + spawn rate, and click **Start**. Charts show RPS, latency
percentiles, and failure rate live.

## Run headless (CI-friendly, fixed duration, CSV report)

```powershell
locust -f loadtest\locustfile.py `
    --host https://<your-railway-app>.up.railway.app `
    --headless `
    -u 100 -r 20 -t 2m `
    --csv=loadtest\report
```

- `-u 100` — peak concurrent users
- `-r 20` — ramp 20 new users per second
- `-t 2m` — run for 2 minutes
- `--csv=loadtest\report` — writes `report_stats.csv`, `report_failures.csv`, etc.

## Spike only `get_nearby_branches`

The file defines a second user class `NearbyBranchesSpikeUser` that has only
the nearby-branches task and a much shorter `wait_time`. To use it:

- In the web UI, after starting, open the **Workers / User classes** panel
  and bump its weight, **or**
- pass `--user-classes NearbyBranchesSpikeUser` on the command line.

## Sensible starting points

| Goal | Users | Spawn rate | Duration |
|---|---|---|---|
| Smoke test | 5 | 1/s | 30s |
| Baseline | 50 | 10/s | 2m |
| Realistic peak | 200 | 25/s | 5m |
| Spike test | 500 | 100/s | 1m |

Watch for:

- **p95 latency** on `POST /webhook [get_nearby_branches]` rising fast — that
  means the haversine loop is dominating; consider caching the parsed branch
  list (in-memory) instead of re-reading on every request.
- **Failures with "no cards; fallback text: '...'"** — those are valid HTTP
  200 responses where the webhook returned a fallback message instead of
  cards. The locustfile flags these as failures so you can see them.
- **HTTP 5xx** — server crashed or hit a quota (Firestore, Sheets, Drive).

## Caution

You are load testing your **production** Railway host by default. To avoid
hitting Firestore / Sheets / Drive quotas:

- Test against a staging deployment, or
- Restrict to read-only routes (`/webhook`, `/api/nearest-branches`, `/api/branches`)
  as this file does (no `/contact-form-submissions` task).
