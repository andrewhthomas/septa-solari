# 30th Street Station Arrivals

A split-flap (Solari) arrivals board for Philadelphia's William H. Gray III 30th Street Station, showing Amtrak, SEPTA Regional Rail, and SEPTA Metro (the L and the T trolleys) arrivals.

Built with Astro, React, and Tailwind CSS 4, and deployed to Cloudflare Workers.

## How it works

- `src/pages/api/arrivals.ts` is a Worker route that fetches both feeds in parallel, normalizes them into one `Arrival` shape, and caches the combined response at the edge for 30 seconds (5 seconds if either source failed). One source failing does not blank the other board.
- `src/lib/amtrak.ts` reads the [Amtraker v3](https://github.com/piemadd/amtrak) feed (`/v3/trains`, station code `PHL`). Amtrak has no official public API; Amtraker is a community service built on Amtrak's own track-a-train data. The whole feed (about 1.2 MB) is fetched and filtered to trains that have not yet departed PHL.
- `src/lib/septa.ts` reads SEPTA's [Regional Rail Arrivals API](https://www3.septa.org/developer/) for station `Gray 30th Street`. SEPTA times come without a time zone and are parsed as Eastern time.
- `src/lib/metro.ts` covers SEPTA Metro: the L and T trolleys at Drexel Station at 30th St (stops `21532`/`32176` for the L, `20643`/`20662` for T1-T5), and the T2 at Baltimore Av & 49th St (`600`/`601`). Rows start from SEPTA's stop schedule API (`BusSchedules`). Trolley rows are then made live, best source first:
  1. **GTFS-realtime TripUpdates** (`rtTripUpdates.pb`): a predicted arrival at that exact stop, published for trips in progress and many not yet started. `src/lib/gtfsrt.ts` is a small purpose-built protobuf reader: it skips every non-trolley trip without decoding it, so the 750 KB feed costs about 1.5 ms of CPU instead of about 11 ms with a full decoder.
  2. **TransitView**: the vehicle's current lateness, for trips in progress.
  3. Otherwise the row says SCHEDULED, which usually means the trolley has not left its terminal yet.

  The schedule API drops a trip once its scheduled time passes, even if the trolley is late and has not arrived. Trips GTFS-RT still predicts for our stops are added back, with destination and lateness from TransitView.

  The L has no usable realtime data: its GTFS-RT trip updates carry no times, only `SKIPPED` flags on the westbound 30th St stop (with no matching service alert), so L rows are scheduled times and say so.
- `src/components/ArrivalsBoard.tsx` polls `/api/arrivals` every 30 seconds (and again when the tab becomes visible) and renders four boards. Rail boards show where a train is arriving from; Metro boards show where it is going. All boards share one flap size so the columns line up. Each character is a `FlapChar` that rotates forward through the drum to its new character, so updates ripple across the board like the real thing. Motion is turned off for `prefers-reduced-motion`.

All times are shown in station time (Eastern), whatever the viewer's time zone.

## Pages

| Path | What it shows |
| --- | --- |
| `/` | 30th Street Station: Amtrak, SEPTA Regional Rail, Metro L, Metro T |
| `/49th-baltimore` | T2 only, at Baltimore Av & 49th St (stops `600` eastbound, `601` westbound). Fed by `/api/49th-baltimore`. Tracked trolleys show live position: Exp (predicted arrival), Next Stop, and a status of `N STOPS AWAY` / `APPROACHING` / `DUE`. Stops away is GTFS-RT's `stop_sequence` for 49th St minus TransitView's `next_stop_sequence`; the two feeds number stops identically (verified across 263 live vehicles). |

To add another stop page, add a stop list and fetcher next to `fetchT2At49th` in `src/lib/metro.ts`, an API route in `src/pages/api/`, and a page plus component modeled on `BaltimoreBoard.tsx`. Stop IDs come from `https://www3.septa.org/api/Stops/index.php?req1=<route>`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Astro dev server at `localhost:4321` |
| `npm run preview` | Build and run the real Worker locally with Wrangler at `localhost:8787` |
| `npm run check` | Type-check |
| `npm run deploy` | Build and deploy to Cloudflare Workers (run `npx wrangler login` first) |

## Notes

- Parsing the full Amtrak feed costs a few milliseconds of CPU. The edge cache means this happens at most about twice a minute per Cloudflare location, which stays within the Workers free plan in normal use. If you see CPU-limit errors, move to the paid plan or raise the cache time.
- Station and line names longer than 16 characters are abbreviated in `SHORT_NAMES` (SEPTA Regional Rail), `DESTINATION_NAMES` (SEPTA Metro) and `ORIGIN_NAMES` / `LINE_NAMES` (Amtrak).
