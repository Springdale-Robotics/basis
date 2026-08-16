-- What the photographer called this page.
--
-- Photographing a binder means naming things as you go — the person holding it
-- knows that these two pages are one recipe and that the next is something
-- else, and nothing downstream can work that out later.
--
-- A plain label rather than a group table, because grouping is the same fact:
-- two pages of one recipe are two scans wearing the same name.
ALTER TABLE "image_parse_sessions" ADD COLUMN "label" varchar(200);
