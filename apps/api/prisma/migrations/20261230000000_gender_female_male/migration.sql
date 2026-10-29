-- Decision 315 item 15 (backlog 3.15): gender is Female, Male or not given.
-- "female"/"male" in any letter case become FEMALE/MALE; every other value was
-- sample data and is cleared.
UPDATE "User"
SET "gender" = CASE lower(btrim("gender")) WHEN 'female' THEN 'FEMALE' WHEN 'male' THEN 'MALE' ELSE NULL END
WHERE "gender" IS NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_gender_female_male" CHECK ("gender" IS NULL OR "gender" IN ('FEMALE', 'MALE'));
