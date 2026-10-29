-- Backlog 3.18: each School keeps a short list of its own belt colours.
ALTER TABLE "School" ADD COLUMN "savedBeltColours" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
