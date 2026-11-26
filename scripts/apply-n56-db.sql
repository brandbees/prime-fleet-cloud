-- N6.2: unique purchase codes when non-empty (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS "License_purchaseCode_nonempty_key"
  ON "License" ("purchaseCode")
  WHERE "purchaseCode" <> '';
