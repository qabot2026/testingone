"""
Locust load test for the contact-form-api service.

Targets the public Dialogflow CX webhook + helper REST endpoints, with the
heaviest weight on `get_nearby_branches` since that's the most recently added
flow. Tasks pick random points within India and a handful of states/cities
to exercise the catalog backfill, haversine sort, and card-carousel rendering.

Run (UI):
    locust -f loadtest/locustfile.py --host https://<your-railway-app>.up.railway.app

Run (headless, 100 users, ramp 20/s, 2 minutes, CSV report):
    locust -f loadtest/locustfile.py --host https://<your-railway-app>.up.railway.app \
        --headless -u 100 -r 20 -t 2m --csv=loadtest/report

Install:
    pip install -r loadtest/requirements.txt
"""

from __future__ import annotations

import random
import time
import uuid
from typing import Any

from locust import HttpUser, between, task

# India bounding box (rough) — keeps random coords realistic for branch data
INDIA_LAT_MIN = 8.0
INDIA_LAT_MAX = 35.0
INDIA_LNG_MIN = 68.0
INDIA_LNG_MAX = 97.0

# A few real city anchors to bias some traffic toward populated areas
ANCHOR_CITIES = [
    ("Pune",      18.5204, 73.8567),
    ("Mumbai",    19.0760, 72.8777),
    ("Delhi",     28.6139, 77.2090),
    ("Bengaluru", 12.9716, 77.5946),
    ("Chennai",   13.0827, 80.2707),
    ("Hyderabad", 17.3850, 78.4867),
    ("Kolkata",   22.5726, 88.3639),
]

# State/city pairs known to exist in the bundled catalog
SAMPLE_STATE_CITIES = [
    ("Maharashtra", "Pune"),
    ("Maharashtra", "Mumbai"),
    ("Karnataka",   "Bengaluru"),
    ("Delhi",       "Delhi"),
    ("Tamil Nadu",  "Chennai"),
    ("Telangana",   "Hyderabad"),
    ("West Bengal", "Kolkata"),
]


def _random_indian_coords() -> tuple[float, float]:
    """50% near a real city anchor (+/-0.3deg jitter), 50% anywhere in India."""
    if random.random() < 0.5:
        _, lat, lng = random.choice(ANCHOR_CITIES)
        return (
            lat + random.uniform(-0.3, 0.3),
            lng + random.uniform(-0.3, 0.3),
        )
    return (
        random.uniform(INDIA_LAT_MIN, INDIA_LAT_MAX),
        random.uniform(INDIA_LNG_MIN, INDIA_LNG_MAX),
    )


def _webhook_body(tag: str, parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a minimal Dialogflow CX webhook request body."""
    session_id = uuid.uuid4().hex
    return {
        "fulfillmentInfo": {"tag": tag},
        "languageCode": "en",
        "sessionInfo": {
            "session": (
                "projects/loadtest/locations/global/agents/loadtest/"
                f"sessions/{session_id}"
            ),
            "parameters": parameters or {},
        },
    }


class ContactFormApiUser(HttpUser):
    """Simulated visitor hitting the chat webhook and helper endpoints."""

    # Locust will sleep this long between consecutive tasks per user.
    wait_time = between(1, 3)

    # ------------------------------------------------------------------
    # Most important: the new nearby-branches webhook tag
    # ------------------------------------------------------------------

    @task(8)
    def webhook_get_nearby_branches(self) -> None:
        lat, lng = _random_indian_coords()
        body = _webhook_body(
            "get_nearby_branches",
            {"user_lat": str(lat), "user_lng": str(lng)},
        )
        with self.client.post(
            "/webhook",
            json=body,
            name="POST /webhook [get_nearby_branches]",
            catch_response=True,
        ) as resp:
            if resp.status_code != 200:
                resp.failure(f"status {resp.status_code}")
                return
            try:
                data = resp.json()
            except Exception as exc:  # noqa: BLE001
                resp.failure(f"non-JSON body: {exc}")
                return
            messages = (
                (data.get("fulfillment_response") or {}).get("messages") or []
            )
            if not messages:
                resp.failure("empty fulfillment messages")
                return
            # First message should be the card carousel payload
            payload = (messages[0] or {}).get("payload") or {}
            cards = payload.get("cards") or []
            if not cards:
                # Server explicitly returned a text fallback (e.g. invalid coords)
                first_text = (messages[0].get("text") or {}).get("text") or []
                resp.failure(
                    f"no cards; fallback text: {first_text!r}"
                )
                return

    # ------------------------------------------------------------------
    # Search-by-city flow
    # ------------------------------------------------------------------

    @task(2)
    def webhook_get_states(self) -> None:
        self.client.post(
            "/webhook",
            json=_webhook_body("get_states"),
            name="POST /webhook [get_states]",
        )

    @task(2)
    def webhook_get_cities(self) -> None:
        state, _ = random.choice(SAMPLE_STATE_CITIES)
        self.client.post(
            "/webhook",
            json=_webhook_body("get_cities", {"state": state}),
            name="POST /webhook [get_cities]",
        )

    @task(2)
    def webhook_get_areas(self) -> None:
        state, city = random.choice(SAMPLE_STATE_CITIES)
        self.client.post(
            "/webhook",
            json=_webhook_body("get_areas", {"state": state, "city": city}),
            name="POST /webhook [get_areas]",
        )

    # ------------------------------------------------------------------
    # REST helpers that the chat widget hits directly
    # ------------------------------------------------------------------

    @task(3)
    def rest_nearest_branches(self) -> None:
        lat, lng = _random_indian_coords()
        self.client.get(
            f"/api/nearest-branches?lat={lat:.5f}&lng={lng:.5f}&limit=5",
            name="GET /api/nearest-branches",
        )

    @task(1)
    def rest_list_branches(self) -> None:
        self.client.get("/api/branches", name="GET /api/branches")

    # ------------------------------------------------------------------
    # Health-style probe (cheap; helps confirm baseline latency)
    # ------------------------------------------------------------------

    @task(1)
    def rest_departments_global(self) -> None:
        self.client.get("/api/departments", name="GET /api/departments")


# ----------------------------------------------------------------------
# Optional: a second user class focused only on get_nearby_branches so you
# can spike it independently with `--class-picker` in the Locust UI.
# ----------------------------------------------------------------------


class NearbyBranchesSpikeUser(HttpUser):
    """Hammers only the nearby-branches webhook for spike testing."""

    wait_time = between(0.1, 0.5)
    weight = 0  # off by default; enable in UI or with `--user-classes`

    @task
    def spike_nearby(self) -> None:
        lat, lng = _random_indian_coords()
        body = _webhook_body(
            "get_nearby_branches",
            {"user_lat": str(lat), "user_lng": str(lng)},
        )
        self.client.post(
            "/webhook",
            json=body,
            name="POST /webhook [get_nearby_branches spike]",
        )
