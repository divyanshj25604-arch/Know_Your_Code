-- Reverts 016_annotations.sql. Loses every annotation.
BEGIN;
DROP TABLE annotations;
DELETE FROM schema_migrations WHERE name = '016_annotations.sql';
COMMIT;
