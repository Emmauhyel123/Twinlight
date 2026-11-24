-- For databases created before username login
ALTER TABLE users ADD COLUMN username text UNIQUE;
UPDATE users SET username = lower(regexp_replace(split_part(email,'@',1),'[^a-z0-9_]','','gi')) || left(id::text,3);
ALTER TABLE users ALTER COLUMN username SET NOT NULL, DROP COLUMN email, ALTER COLUMN profession SET DEFAULT 'dreamer';
