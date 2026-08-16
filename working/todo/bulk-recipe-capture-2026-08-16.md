# Bulk recipe capture — plan and tracker

Started 2026-08-16. Long-running; expect this to span many sessions.

## The situation being designed for

Someone sits down with a binder of a few hundred recipes. Some printed, some
handwritten, some one page, some several, sometimes two recipes sharing a page.

With what exists today (v0.1.29) that is hours of sitting: each photo blocks on
its own parse before the next can start, and the browser has to stay open the
whole time. The work itself — pointing a camera at pages — takes minutes. Almost
all the elapsed time is waiting.

**The goal is to separate the three things that currently happen together:**
capturing, parsing, and reviewing. Photograph the binder in one sitting, walk
away, come back to work that has already been done.

## What is already true (checked, not assumed)

Worth knowing before designing anything, because it makes phase 0 much cheaper
than it looks:

- **Parsing already runs server-side.** `imageParseWorker` is a BullMQ worker
  (`backend/src/jobs/index.ts`, `concurrency: 1`). Closing the browser does not
  stop a parse. The blocking is entirely client-side: `useBatchImageProcessing`
  polls with the dialog open.
- **~~`IMAGE_PARSE_SESSION_TTL_HOURS` is 24, so walking away loses the work.~~**
  **Wrong — corrected 2026-08-16.** The constant existed and was written into an
  `expires_at` column, but *nothing enforced it*: the only function that read
  the column was exported and never called. Seventeen-day-old scans were sitting
  on the production box. Walking away already worked, by accident.
  The real risks were the reverse — unbounded growth, and the standing trap that
  anyone "fixing" the dead function would have started deleting recipe-card
  photographs a day after they were taken. Resolved; see phase 0.2.
  *Lesson worth keeping: I checked that the constant existed, not that anything
  acted on it. Same masking shape as a tenancy test that passes because RLS is
  doing the work.*
- **Throughput is one image at a time** on an 8GB card, ~5–12s warm. 200 photos
  ≈ 20–40 minutes, longer with cold model loads. Fine for walking away; not
  something to watch.
- **Ingredient-level reconciliation already exists** (v0.1.29): `plan-items`
  proposes merges before anything is written, and never decides on its own.
- **Originals are kept on disk** at `${STORAGE_PATH}/image-parse`. 200 photos at
  ~3MB is ~600MB per binder session. Abandoned scans are now swept (phase 0.2);
  scans behind real recipes are deliberately kept, because **nothing copies the
  photograph onto the recipe** — for a handwritten card that file is the only
  copy in the account.

## Decisions taken

| Decision | Why |
| --- | --- |
| Capture, parse and review are separate stages | The whole point. Waiting is the cost, not the work. |
| Photos upload immediately, marked unparsed | Upload is fast; parsing is slow. Uploading straight away means a dropped phone or a crashed tab costs nothing, and avoids IndexedDB quotas and iOS eviction. |
| Crop / rectangle regions are in scope | A page often cannot be photographed without catching the neighbouring recipe, and the stray text confuses the parser. A crop is the minimum; multiple rectangles on one photo is the fuller version. |
| Quality check happens **during** capture, before upload completes | Blocking a bad photo costs seconds while the binder is open. Discovering it later costs a second session with the binder back on the shelf. |
| Recipe-level duplicate detection | Photographing a binder reliably produces the same recipe twice, and collections hold near-duplicates. |
| Review is prioritised by confidence | The difference between hours and minutes is showing the twelve that need attention, not all two hundred. |
| Nothing merges or discards automatically | Same stance as ingredient reconciliation. Propose; let the household decide; remember the answer. |

### Rejected, with reasons (do not re-propose without new evidence)

- **Round-tripping through Excel for editing.** At review time the task is
  correcting OCR *against the picture* — "1 c. sow cream" is only fixable while
  looking at the card. A spreadsheet severs the text from its source, so it
  would be proofreading blind. It also doubles the surface area: export format,
  re-import, merge-back, and "I edited row 40 and also re-parsed it". The
  in-app editor should show image beside text and be good enough that nobody
  wants the spreadsheet. Spreadsheet **import** (v0.1.29) stays; it solves a
  different problem — people who already keep recipes that way.

## Shape of the finished thing

```
   capture ──────────────► upload ──────► queued ──────► parsed ──────► reviewed ──────► saved
   (binder open)          (immediate)   (background)   (prioritised)   (duplicates)   (inventory)
        │                                    │                              │
   quality check                     walk away, close                recipe + ingredient
   blocks bad shots                  the laptop                      reconciliation
```

The load-bearing new concept is a **durable import batch**: something with an
identity and a status that survives closing the laptop and can be found again
from a phone. Everything else hangs off it.

---

## Phase 0 — Make walking away possible

The unblock. Mostly wiring work that already runs to a UI that does not yet
assume it.

- [ ] **0.1 — Batch entity.** Migration `0014`: `recipe_import_batches`
      (household, created_by, name, status, counts, timestamps) and a
      `batch_id` on `image_parse_sessions`.
      *Hand-author the migration + journal + snapshot — `drizzle-kit generate`
      is broken here. Household-scoped, so it needs an RLS policy following
      `drizzle/0008_rls_all_tables.sql` and a check in `backend/test/rls/`.*
- [x] **0.2 — Retention depends on what a session is, not how old it is.**
      *Done 2026-08-16.* The fake `expires_at` is no longer written (migration
      `0014` makes it nullable) and `IMAGE_PARSE_SESSION_TTL_HOURS` is gone.
      `cleanupAbandonedImageScans` sweeps only `failed`, `cancelled`, and
      `uploading`/`processing` older than 7 days, daily.
      **`review` and `confirmed` are never collected, at any age** — a
      photographed card sits in `review` with its recipe already saved, and the
      image is the only copy. Revisit only after 0.7.
      Batch-awareness hook goes here once `batch_id` exists: an open batch must
      also never be swept, whatever its sessions' statuses say.
- [ ] **0.3 — Batch status endpoint.** One call returns counts by state for the
      batch. Replaces per-session polling.
      *Tenancy test required (new route).*
- [ ] **0.4 — Batch survives the client.** Reload, close the tab, open on a
      phone — the batch is found and resumed. Remove the assumption that the
      dialog owns the lifecycle (`useBatchImageProcessing`).
- [ ] **0.5 — Ambient progress.** A small indicator visible anywhere in the app,
      not tied to the import dialog, showing an in-flight batch and its progress.
- [ ] **0.6 — Tell them when it is done.** Use the existing notification module
      so the answer to "is it finished?" doesn't require checking.
- [x] **0.7 — The photograph becomes part of the recipe.** *Done 2026-08-16.*
      Migration `0015`: `recipes.photo_paths`,
      `recipe_import_sessions.image_session_ids`, and
      `image_parse_sessions.consumed_by_recipe_id`. The import carries the scan
      ids through, and after the recipe saves it takes its own copy of the
      photographs — both sides of a card, in capture order — served from
      `GET /recipes/:id/photo/:index` and pointed at by `imageUrl`, so the
      recipe *shows* the card it came from.
      Copies rather than references, which is what unblocks retention: a
      harvested scan is now marked `consumed_by_recipe_id` and its photograph
      exists elsewhere. Best-effort throughout — a recipe that saved correctly
      is never undone by a failed file copy, and nothing is deleted here.
      Bulk image mode threads its scan ids too, so a batch-imported photo is
      kept the same way.
      **Follow-up:** retention can start collecting scans marked
      `consumed_by_recipe_id` once that has been true for long enough to trust.

**Phase 0 is done when:** photograph ten pages, close the browser entirely,
reopen an hour later, and the parses are finished and waiting.

---

## Phase 1 — Capture

The binder-open stage. Speed and not-having-to-come-back-to-this matter more
than anything else here.

- [ ] **1.1 — Capture screen.** Take a photo, it uploads immediately, a thumbnail
      joins a strip, camera stays ready for the next. No per-photo dialogs.
- [ ] **1.2 — Quality check before it counts.** Run on-device where possible so
      the verdict is instant. Blur, too-small, too-dark, no-text-found → refuse
      the photo with the reason and offer **Retake** (primary) or **Use anyway**.
      *Bias deliberately toward flagging: a false "blurry" costs seconds; a
      missed blur costs a whole second session with the binder.*
      **Open question:** what actually detects blur well enough — variance of
      Laplacian on a downscaled greyscale copy is the usual answer and is cheap
      in canvas. Needs a real trial against genuinely bad photos.
- [ ] **1.3 — Naming.** Each image gets a name; default to something ordinal so
      nobody is forced to type. Renaming is cheap and always available.
- [ ] **1.4 — Multi-page grouping.** Assign a new photo to an existing name, so
      "Spoon Bread" can be two photos. The person holding the binder knows this;
      the parser never will.
- [ ] **1.5 — Crop.** Trim a photo to one recipe. The minimum viable form of the
      next item, and on its own solves most of the stray-text problem.
- [ ] **1.6 — Rectangle regions.** Draw more than one rectangle on a single
      photo, each becoming its own recipe with its own name. Hardest UI in the
      project: touch, pinch-zoom, undo, small screens.
      *Consider building 1.5 first and shipping it; 1.6 may turn out to be rare
      enough to defer, and that is worth learning from use rather than guessing.*
- [ ] **1.7 — Bad signal.** Capture must not fail in a kitchen with poor wifi.
      There is an offline mutation queue at `frontend/src/lib/offline/sync`;
      decide whether uploads join it or get their own retry.

**Phase 1 is done when:** a binder page holding two recipes becomes two
correctly-cropped, correctly-named items without the parser ever seeing the
neighbouring text.

---

## Phase 2 — Parsing in the background

- [ ] **2.1 — Enqueue per batch.** Parsing starts because a batch was captured,
      not because a dialog is open.
- [ ] **2.2 — Keep concurrency at 1** and make the queue's position visible.
      Two 7B inferences on an 8GB card contend rather than overlap — this was
      established in v0.1.24 and should not be "optimised" without measurement.
- [ ] **2.3 — Per-item failure.** One unreadable photo must not stop the batch,
      must say why, and must be retryable without re-capturing.
- [ ] **2.4 — Honest ETA.** Derived from measured throughput, not a guess.

---

## Phase 3 — Prioritised review

- [ ] **3.1 — Triage by confidence.** Sort so that what needs attention comes
      first, and say how many are fine. Confidence is already computed and
      currently unused for this.
- [ ] **3.2 — Image beside text.** The editor shows the photograph next to the
      extracted text. This is what makes the rejected spreadsheet round-trip
      unnecessary; if it isn't good, that decision gets re-opened.
- [ ] **3.3 — Accept the confident ones in bulk**, with the option to look.
- [ ] **3.4 — Field-level confidence.** Highlight the specific parts the parser
      was unsure of rather than flagging a whole recipe.

---

## Phase 4 — Recipe-level duplicates

Completes the reconciliation work one level up from ingredients.

- [ ] **4.1 — Within the batch.** The same recipe photographed twice.
- [ ] **4.2 — Against the collection.** Already-imported recipes, including
      near-duplicates ("Mom's Banana Bread" / "Banana Bread").
- [ ] **4.3 — Propose, never decide.** Merge, keep both, or replace — chosen by
      the household. Reuse `calculateSimilarityWithReason`; do **not** write a
      second similarity implementation.
      *A title alone is weak evidence — two different cakes share a name. Compare
      on ingredients as well.*

---

## Phase 5 — Final data quality

- [ ] **5.1 — Measure the review burden.** How many decisions does a 200-recipe
      import actually demand? This is the number that decides whether any of
      this is usable, and it is currently unknown.
- [ ] **5.2 — Ingredient reconciliation at batch scale.** v0.1.29 handles it;
      whether it holds up across hundreds of ingredients at once is untested.
- [ ] **5.3 — Storage.** ~600MB per binder session accumulates and nothing
      removes originals after a successful import. Decide retention and act on
      it — likely keep originals while a recipe is unreviewed, then thumbnail.

---

## Cross-cutting requirements

Applies to every phase; not optional.

- **Tenancy.** Every new route filters by `householdId` and gets a tenancy test.
  Note that route-level tests can be masked by RLS — verify by falsification
  (issue #69).
- **RLS.** Every new household-scoped table needs a policy and a check in
  `backend/test/rls/`.
- **Migrations** are hand-authored with journal and snapshot; next is `0014`.
- **No keyword lists for structural decisions.** Classify on shape — numerals,
  punctuation, position. A word list fails silently on whatever it omits.
- **One implementation of any matching rule.** Similarity and identity
  normalisation live in `ingredient-matching.service.ts`; import them.
- **Verify against a running stack**, not by reading. Several bugs this month
  were invisible to a passing test suite and obvious in a browser.

## Risks and open questions

| Risk | Notes |
| --- | --- |
| Rectangle UI on a phone | The hardest thing here. Ship crop (1.5) first and learn whether 1.6 is needed. |
| Blur detection quality | Unproven. Needs a trial against real bad photos before it gates uploads. |
| Review burden at 200 recipes | Unmeasured, and it decides whether the whole workflow is usable. Phase 5.1 exists to find out early — consider moving it earlier. |
| GPU contention | A long import competes with everything else the box does. |
| Storage growth | ~600MB per session. Abandoned scans swept. 0.7 now copies photographs onto recipes, so consumed scans are collectable — but that sweep is not yet written, and the copy temporarily doubles the bytes. |
| Scope | This is months of work. Phase 0 alone delivers most of the felt benefit and should ship on its own. |

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Walking away | In progress | 0.2 done. Highest value, lowest cost. |
| 1 — Capture | Not started | 1.2 quality check and 1.5 crop matter most. |
| 2 — Background parsing | Not started | Mostly already true; needs surfacing. |
| 3 — Prioritised review | Not started | |
| 4 — Recipe duplicates | Not started | |
| 5 — Data quality | Not started | 5.1 may deserve to come early. |
