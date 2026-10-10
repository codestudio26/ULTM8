-- Who may book (Decision 173): each rung lists the class types it unlocks for
-- booking, for it and every rung above. Additive. Existing rungs start with
-- none, so every class stays open until the school owner sets some.
ALTER TABLE "RankStripeTier" ADD COLUMN "bookingUnlocksClassTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
