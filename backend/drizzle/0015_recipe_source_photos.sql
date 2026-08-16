-- Keep the photograph the recipe came from.
--
-- A photographed recipe card is read for its text and then forgotten: the
-- import creates the recipe through the text path, so nothing connects the two
-- and the image survives only because image-parse retention deliberately never
-- sweeps a scan in `review` (see 0014). For a handwritten card that file is the
-- only copy in the account, and it is arguably worth more than the parse.
--
-- So the recipe takes a copy of its own. `image_data` is base64 in the row and
-- unsuitable for a 3MB photograph, so paths are stored and the bytes are served
-- from disk, the way receipt scans already work.
--
-- Copies rather than references, so that image-parse retention can eventually
-- sweep harvested scans without taking recipe photographs with them.
ALTER TABLE "recipes" ADD COLUMN "photo_paths" jsonb;

-- Which scans a recipe import was built from. Verified against the caller's
-- household when supplied — these are ids crossing a module boundary.
ALTER TABLE "recipe_import_sessions" ADD COLUMN "image_session_ids" jsonb;

-- Records that a scan has been harvested and its photograph preserved
-- elsewhere. An explicit column rather than a status, because several
-- operations require `review` and would break if it moved.
ALTER TABLE "image_parse_sessions" ADD COLUMN "consumed_by_recipe_id" uuid;

ALTER TABLE "image_parse_sessions"
  ADD CONSTRAINT "image_parse_sessions_consumed_by_recipe_id_recipes_id_fk"
  FOREIGN KEY ("consumed_by_recipe_id") REFERENCES "recipes"("id") ON DELETE SET NULL;
