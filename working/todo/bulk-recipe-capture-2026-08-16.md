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

- [x] **0.1 — Batch entity.** *Done 2026-08-16, migration `0016`.*
      `recipe_import_batches` (household, created_by, name, open/closed,
      timestamps) with its RLS policy, and a nullable `batch_id` on
      `image_parse_sessions` so nothing existing had to change.
      Routes: create, list-with-progress, detail, close. A scan can name its
      batch at upload, checked against the household first.
      **Counts are derived from the scans, never stored on the batch** — two
      records of the same thing drift, and a stale progress number is worse
      than no progress number.
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
- [x] **0.3 — Batch status endpoint.** *Done 2026-08-16 as part of 0.1.*
      `GET /image-parse/batches` returns every open batch with total / ready /
      working / failed counted from the scans. Replaces per-session polling.
- [x] **0.4 — Batch survives the client.** *Done 2026-08-16.* An unfinished
      session is offered on arrival — offered, never assumed, because quietly
      appending a new binder to yesterday's is not recoverable from — and
      `?batch=` opens one directly. Its pages come back with their names and
      their photographs, served from the box, since the frames are long gone
      from whatever device took them.
- [x] **0.5 — Ambient progress.** *Done 2026-08-16.* A quiet pill anywhere in
      the app: "Reading 3 of 40", or "12 recipes read — review", linking back
      to the session. It appears only when there is something to say, hides on
      the capture page which says it better, and stops asking while the tab is
      in the background.
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

- [x] **1.1 — Capture screen.** *Done 2026-08-16.* `/recipes/capture`, reached
      from a Photograph button on the recipes page. A live in-page camera that
      stays open, so a binder is a run of taps rather than hundreds of trips
      through the OS camera — which is what produced "it didn't let me take
      multiple pictures". Falls back to the file picker where no camera can be
      opened. Each page uploads immediately into a batch.
- [ ] **1.2 — Quality check before it counts.** Run on-device where possible so
      the verdict is instant. Blur, too-small, too-dark, no-text-found → refuse
      the photo with the reason and offer **Retake** (primary) or **Use anyway**.
      *Bias deliberately toward flagging: a false "blurry" costs seconds; a
      missed blur costs a whole second session with the binder.*
      *Shipped 2026-08-16 in `frontend/src/lib/photo-quality.ts`: brightness
      and sharpness measured on the captured frame before it uploads, refused
      with the reason and a Retake, with "keep it anyway" always available
      because the photographer can see the page and we cannot.*

      **Trialled 2026-08-16 — the obvious heuristic is necessary but not
      sufficient.** Variance of the Laplacian on a downscaled greyscale copy,
      measured against a real recipe-card photo (sharp = 1685):

      | variant | score | vs sharp |
      | --- | --- | --- |
      | as taken | 1685 | 100% |
      | gaussian blur σ=3 | 491 | 29% |
      | gaussian blur σ=5 | 125 | 7% |
      | very dark, in focus | 74 | **4%** |
      | too far away / low detail | 1671 | **99%** |

      Three things follow, and they change what this task can promise:

      1. **It separates defocus blur well.** That much works.
      2. **It cannot tell dark from blurry** — an in-focus but underexposed
         photo scores *below* a badly blurred one. So brightness must be
         measured separately, or the app will tell someone to hold still when
         they need to turn a light on. Wrong advice is worse than none.
      3. **It does not notice a photo taken from too far away**, which scores
         99% of sharp while being just as unreadable. A separate signal is
         needed — probably the size of the text region rather than the whole
         frame.

      Also unresolved: the absolute number is content-dependent (a dense
      printed page will not score like a sparse handwritten card), so a single
      global threshold is unsafe without calibrating across many real photos.
      And an attempt to approximate camera shake failed — it scored 98% of
      sharp, meaning it never actually blurred anything, so **real motion blur
      remains untested** and it is the most likely cause in practice.

      Practical reading: gate only on egregious cases at first, report the
      *reason* from whichever measure fired, and expect to tune against real
      photographs rather than synthetic ones.
- [x] **1.3 — Naming.** *Done 2026-08-16, migration `0017`.* A `label` on the
      scan, defaulted to an ordinal at capture and editable in the strip. A
      plain label rather than a group table because grouping is the same fact:
      two pages of one recipe are two scans wearing the same name — which is
      what 1.4 will set.
- [x] **1.4 — Multi-page grouping.** *Done 2026-08-16.* Pages wearing the same
      name are one recipe, joined in the order they were taken — the back of a
      card continues the front, often mid-sentence. A page offers to take the
      previous page's name in one tap, and names already used are suggested,
      because retyping a name exactly is a poor way to ask for this.
      The grouping is applied on the server (`/batches/:id/compose`) so it is
      one rule rather than two, and an unnamed page is a recipe of its own
      because nothing said otherwise. Pages that were replaced or could not be
      read are left out and counted, not silently dropped.
      This also closed the gap that made grouping meaningless: a batch now has
      a way to become recipes at all, handing its composed text to the existing
      review, matching and reconciliation.
- [x] **1.5 — Crop.** *Done 2026-08-16.* Offered for the page just taken —
      which is the moment anybody notices the recipe next to it crept into
      shot — and drawn by dragging one corner to the other, with everything
      outside the box dimmed. No resize handles: they need precision a thumb
      does not have, and redrawing is faster than nudging.
      Only the last frame is held, because a binder's worth of decoded images
      would not fit in a phone. The crop is uploaded as a new page and the
      uncropped one cancelled only once it is safely up, so a failure anywhere
      leaves the original standing. A cancelled scan is one the retention sweep
      already collects.
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

- [x] **5.1 — Measure the review burden.** *Measured 2026-08-16, and it found
      two defects in the shipped reconciliation.*

      The encouraging part: the burden scales with the **vocabulary**, not the
      recipe count. Identity dedupe collapsed 1400 ingredient mentions from 200
      recipes into ~100 distinct decisions, of which ~20% were raised as
      look-alikes. Reviewing a collection is therefore a question of how varied
      a kitchen is, not how many recipes were photographed — which is what
      makes the whole workflow plausible.

      Two things only visible at that size, both now fixed:

      - **Clustering ran away.** Groups are built by transitive closure, so a
        chain of near-identical names drags everything in. A thousand
        ingredients collapsed into *two* clusters covering 1003 of them — a
        dialogue asking "are these 1003 the same?" is worse than offering
        nothing. Capped at 8 per group.
      - **Cost is quadratic and it showed.** 141ms at 120 ingredients, but
        **9 seconds** at a thousand. Comparison is now bounded; names past the
        ceiling are still created, just without suggestions. A thousand
        ingredients now plans in under a second.

      Still unmeasured: how long a person actually takes over those ~20 groups
      and ~100 confirmations. That needs a real collection, not a generated
      one.
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
| Blur detection quality | Partly answered (see 1.2). Defocus is detectable; darkness is confusable with blur; distance is invisible to it; motion blur still untested. Needs real bad photographs, not synthetic ones. |
| Review burden at 200 recipes | Measured (5.1): ~100 decisions for 200 recipes, because it scales with vocabulary rather than recipe count. Two defects found and fixed. The human time over those decisions is still unmeasured. |
| GPU contention | A long import competes with everything else the box does. |
| Storage growth | ~600MB per session. Abandoned scans swept. 0.7 now copies photographs onto recipes, so consumed scans are collectable — but that sweep is not yet written, and the copy temporarily doubles the bytes. |
| Scope | This is months of work. Phase 0 alone delivers most of the felt benefit and should ship on its own. |

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| 0 — Walking away | Nearly done | 0.1–0.5 and 0.7 done. Remaining: 0.6, telling you when it has finished. |
| 1 — Capture | In progress | 1.1–1.5 done. Remaining: 1.6 rectangles, 1.7 bad signal. |
| 2 — Background parsing | Not started | Mostly already true; needs surfacing. |
| 3 — Prioritised review | Not started | |
| 4 — Recipe duplicates | Not started | |
| 5 — Data quality | In progress | 5.1 measured; found and fixed two defects in shipped reconciliation. |
