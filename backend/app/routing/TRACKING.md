# Tracking Module

Files: `app/api/routes/tracking.py`, `app/routing/`

---

## What it does

ALNS (Adaptive Large Neighbourhood Search) is a VRP algorithm that finds the best sequence of delivery stops by iteratively destroying and repairing a candidate route. If it seems confusing at first, dont worry, since it actually is confusing. Took me like a whole day to understand the basics of it, but here are two videos that explain it well:

https://www.youtube.com/watch?v=RfPF_4x6YG8&t=1175s
https://www.youtube.com/watch?v=Lzg4m85tcqY&t=326s

The tracking endpoint geocodes the merchant pickup and customer delivery addresses, runs ALNS to determine the optimal stop order, then returns an ordered `waypoints` array. The frontend uses that array to draw a road-following route through all stops on the Mapbox map.

---

## Relevant files

| File | Role |
|---|---|
| `app/api/routes/tracking.py` | Endpoint — geocodes addresses, calls routing service, returns response |
| `app/routing/service.py` | Converts geocoded coordinates into `Stop` objects and calls `solver.solve()` |
| `app/routing/solver.py` | Instantiates `ALNS`, registers operators, calls `iterate()`, returns best state |
| `app/routing/state.py` | `RouteState` and `Stop` dataclasses; `objective()` = total Euclidean route distance |
| `app/routing/operators/destroy.py` | `random_removal`, `worst_removal` |
| `app/routing/operators/repair.py` | `greedy_insert`, `random_insert` |

---

## Endpoint

```
GET /tracking/{order_id}
Authorization: Bearer <backend_access_token>
```

### Response

```json
{
  "order_id": 1,
  "waypoints": [
    { "lat": 14.6048, "lng": 120.9881, "label": "Pickup: Farm Name", "type": "pickup" },
    { "lat": 14.5292, "lng": 121.0379, "label": "Your Location",     "type": "delivery" }
  ],
  "origin":      { "lat": 14.6048, "lng": 120.9881 },
  "destination": { "lat": 14.5292, "lng": 121.0379 },
  "progress": 0.4231,
  "eta_minutes": 2
}
```

| Field | Description |
|---|---|
| `waypoints` | ALNS-ordered list of stops. Each entry has `lat`, `lng`, `label`, and `type` (`"pickup"` or `"delivery"`). This is what the frontend passes to the Mapbox Directions API. |
| `origin` | First waypoint coordinates — kept for convenience |
| `destination` | Last waypoint coordinates — kept for convenience |
| `progress` | 0.0 = just left origin, 1.0 = arrived. Currently time-based (cycles every 2 min). Replace with real driver GPS later. |
| `eta_minutes` | Remaining minutes based on progress |

---

## How the data flows

```text
Request arrives with JWT
        ↓
get_current_user (dependencies.py)
  Reads Bearer token from Authorization header or backend_access_token cookie
  Decodes JWT → finds User row in backend_users table
        ↓
Query: Order JOIN OrderHistory WHERE order_id = ? AND user_id = current_user.id
  Verifies the order belongs to this user (404 if not found or wrong user)
        ↓
Resolve addresses
  Origin      → order.merchant.location         (Merchant.location column)
  Destination → order.delivery_address           (set at checkout)
              → fallback: user.address + user.city (from profile)
        ↓
_geocode(address)  ×2  (run in parallel via asyncio.gather)
  Checks _geocode_cache first (dict, lives in process memory)
  Cache miss → _geocode_sync() runs in a thread pool executor
    Calls Mapbox Geocoding API:
    GET https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json
        ?country=PH&limit=1&access_token=MAPBOX_ACCESS_TOKEN
    Parses features[0].center → [lng, lat] → stores as (lat, lng)
  Stores result in cache
        ↓
routing/service.py — compute_route()
  Builds Stop(order_id, merchant_id, lat, lng) for the customer delivery point
  Depot = merchant geocoords (rider starts at pickup)
  Single stop → returned as-is (no solver overhead)
  Multiple stops → solver.solve() runs ALNS for up to 1 000 iterations:
    Each iteration:
      1. Destroy operator selected (random_removal or worst_removal)
         → moves 10–30% of stops into `unassigned`
      2. Repair operator selected (greedy_insert or random_insert)
         → reinserts every unassigned stop at cheapest position
      3. objective() evaluated on candidate route
      4. SimulatedAnnealing decides accept or reject
      5. New best → saved
  Returns ordered Stop list
        ↓
Build waypoints array
  [pickup waypoint (merchant)] + [ordered delivery waypoints from ALNS]
        ↓
Compute progress
  elapsed = time.time() % 120     (unix timestamp mod 2 minutes)
  progress = elapsed / 120        (0.0 → 1.0, loops every 2 min)
  eta_minutes = ceil((1 - progress) * 120 / 60)
        ↓
Return TrackingResponse
```

---

## What the frontend does with the response

`app/(app)/track/page.tsx` receives the response and:

1. **First poll only** — passes the full `waypoints` array to `fetchRouteGeoJSON(waypoints, token)`, which calls the Mapbox Directions API with all waypoints as a multi-stop route. Draws the road geometry as a green line. Calls `map.fitBounds()` using a bounding box that encompasses all waypoints.
2. **First poll only** — places a marker at each waypoint: blue for `"pickup"`, red for `"delivery"`. Marker label comes from `waypoint.label`.
3. **Every poll** — uses `turf.along(route, progress * totalDistance)` to compute the driver marker's road-snapped position. Updates the green dot.

The backend never calls the Mapbox Directions API — it only geocodes. All road geometry and marker animation happen client-side.

Shared frontend utilities: `util/tracking.ts`

- `fetchRouteGeoJSON(waypoints: LatLng[], token)` — multi-waypoint Directions API call
- `getPositionAlongRoute(route, progress)` — turf position math

Frontend types: `util/api/tracking.ts`

- `Waypoint` — `{ lat, lng, label, type }`
- `TrackingData` — includes `waypoints`, `origin`, `destination`, `progress`, `eta_minutes`

---

## ALNS operators

### Destroy

| Operator | What it does |
| --- | --- |
| `random_removal` | Removes a random 10–30% of stops |
| `worst_removal` | Removes stops that contribute the most distance, with a noise factor so it's not fully deterministic |

### Repair

| Operator | What it does |
| --- | --- |
| `greedy_insert` | For each unassigned stop, tries every position and picks the smallest distance increase |
| `random_insert` | Inserts at a random position — adds diversity when greedy gets stuck |

### Acceptance criterion

`SimulatedAnnealing(start_temperature=1.0, end_temperature=0.01, step=0.9998)`

Temperature decays multiplicatively each iteration. Early on, worse solutions can still be accepted (exploration). Later, only improvements get through (exploitation). These values are placeholders — tune once real multi-stop distance data is available.

---

## Required environment variable

```env
MAPBOX_ACCESS_TOKEN = pk.eyJ1...
```

Set in `backend/.env` and in Railway. Same key as the frontend's `NEXT_PUBLIC_MAPBOX_API_KEY`.

---

## Geocode cache

`_geocode_cache` is a plain Python dict in process memory. It persists for the lifetime of the server process and is never evicted — merchant and user addresses change rarely, so this avoids burning Geocoding API quota on every 3-second poll.

**Implication:** if a merchant updates their `location` or a user updates their `address`, the old geocoded coordinates stay cached until the server restarts. Acceptable for now. If it becomes a problem, add a TTL or invalidate the cache key when the address is updated.

---

## What still needs to happen 

1. **Rider depot position** — `compute_route()` currently uses the merchant's geocoords as the depot (i.e. rider starts at pickup). When the driver app exists, replace this with the rider's live GPS so ALNS optimises from their actual position. Requires a `PATCH /tracking/{order_id}/location` endpoint and a `driver_lat`/`driver_lng` field on `CurrentOrder` (or a separate `DriverLocation` table).
2. **Multi-order batching** — the endpoint currently solves one order at a time. The real value of ALNS is over a batch of orders assigned to one rider. A future endpoint (e.g. `GET /tracking/batch/{rider_id}`) would pull all `CurrentOrder` rows for a rider, build one `Stop` per order, and let ALNS sequence them optimally. The solver is already built for this — only the endpoint and batching logic are missing.
3. **Real progress computation** — once the driver app pushes GPS, replace `time.time() % 120 / 120` with distance-along-route calculated from the driver's actual position (Mapbox Map Matching API or manual projection onto the route geometry).

---

## Error responses

| Status | When |
|---|---|
| 401 | Missing or invalid JWT |
| 404 | Order not found, or order belongs to a different user |
| 422 | Merchant has no `location` set |
| 422 | No delivery address on the order or the user's profile |
| 422 | Mapbox Geocoding API returned no result for the address string |
