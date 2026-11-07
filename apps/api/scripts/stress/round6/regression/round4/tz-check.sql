-- Every generated Class starts and ends at its slot's local wall-clock time, on its
-- slot's weekday, in the Branch's (else the School's) time zone. Columns are UTC
-- timestamps without a zone, hence the double AT TIME ZONE.
with x as (
  select coalesce(b.timezone, s.timezone, 'UTC') tz,
         (c."startDate" at time zone 'UTC') at time zone coalesce(b.timezone, s.timezone, 'UTC') loc,
         (c."endDate" at time zone 'UTC') at time zone coalesce(b.timezone, s.timezone, 'UTC') locend,
         t."startTime" st, t."endTime" et, t.weekday::text wd
  from "Class" c join "TimetableSlot" t on t.id = c."timetableSlotId"
  join "Branch" b on b.id = c."branchId" join "School" s on s.id = c."schoolId")
select tz, count(*) n, sum((loc::time <> st)::int) wrong_start, sum((locend::time <> et)::int) wrong_end,
       sum((trim(to_char(loc, 'FMDAY')) <> wd)::int) wrong_day
from x group by 1 order by (sum((loc::time <> st)::int) + sum((locend::time <> et)::int) + sum((trim(to_char(loc, 'FMDAY')) <> wd)::int)) desc, 1;
