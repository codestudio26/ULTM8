-- Decision 319 §4 / Decision 353 (Q8) — two Timetable settings on the School:
-- the week's first day and the layout the Timetable opens in. The defaults are
-- what every School has today (Monday, list).
CREATE TYPE "WeekStartDay" AS ENUM ('MONDAY', 'SUNDAY');
CREATE TYPE "TimetableLayout" AS ENUM ('LIST', 'GRID');

ALTER TABLE "School" ADD COLUMN "weekStartsOn" "WeekStartDay" NOT NULL DEFAULT 'MONDAY';
ALTER TABLE "School" ADD COLUMN "timetableDefaultLayout" "TimetableLayout" NOT NULL DEFAULT 'LIST';
