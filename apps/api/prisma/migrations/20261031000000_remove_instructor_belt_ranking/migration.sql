-- The owner's typed "Belt ranking" on an Instructor profile is removed, with
-- its stored values (Decision 196): instructors choose their own belt per
-- style instead (InstructorBelt, Decision 188).
ALTER TABLE "Instructor" DROP COLUMN "beltRanking";
