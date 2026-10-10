-- Who can watch a lesson (Decisions 154, 190, 195).
--
-- MembershipPlan: the styles it covers, and "Includes lessons" (on by default
-- for priced plans, off for free ones). Lesson: "free" (watchable by every
-- student and guardian at the School). The API decides who sees which lesson:
-- staff all; a student (or their guardian) the free ones and those whose
-- styles a live membership of theirs covers on a plan that includes lessons.
--
-- Existing plans: so today's members keep the lessons they can watch now
-- (every lesson, before this change), each existing plan covers every style
-- its School has today, and includes lessons when it has a price. The owner
-- can change both on each plan.

ALTER TABLE "MembershipPlan" ADD COLUMN "disciplineIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MembershipPlan" ADD COLUMN "includesLessons" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN "free" BOOLEAN NOT NULL DEFAULT false;

UPDATE "MembershipPlan" p
SET "includesLessons" = (p."price" > 0),
    "disciplineIds" = COALESCE((SELECT array_agg(d."id" ORDER BY d."id") FROM "Discipline" d WHERE d."schoolId" = p."schoolId"), ARRAY[]::TEXT[]);
