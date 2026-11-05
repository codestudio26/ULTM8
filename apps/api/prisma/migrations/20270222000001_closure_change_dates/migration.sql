-- Decision 431 item 11 (stress test round 5, AE-9 / TIME-11): the owner can
-- change a closure's dates and reason (PATCH /closures/:id), e.g. an Eid
-- closure after the moon sighting. Only those three columns; the School and
-- Branch a closure covers never change. The existing closure_tenant_isolation
-- policy (FOR ALL) already limits the rows, and TimetableService checks the
-- caller is the School owner, as for adding and removing one.
GRANT UPDATE ("startDate", "endDate", "reason") ON "Closure" TO ultm8_app;
