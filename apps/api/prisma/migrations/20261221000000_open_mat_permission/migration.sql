-- "Can start open mat sessions" (Decision 304 item 4; this build: Decision 386,
-- front-desk handover F10): a per-person switch the School owner gives to
-- Branch Staff or coaches, off for everyone by default. StaffPermission's
-- existing grants and policies apply (the owner manages it, the person reads
-- their own).

ALTER TABLE "StaffPermission" ADD COLUMN "canStartOpenMat" BOOLEAN NOT NULL DEFAULT false;
