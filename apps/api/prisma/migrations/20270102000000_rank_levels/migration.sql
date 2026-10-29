-- Decision 290 (backlog 3.19): a style shows its ranks as Belts or as Levels.
CREATE TYPE "RankDisplay" AS ENUM ('BELTS', 'LEVELS');

ALTER TABLE "Discipline" ADD COLUMN "rankDisplay" "RankDisplay" NOT NULL DEFAULT 'BELTS';
