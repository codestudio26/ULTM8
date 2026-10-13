-- Decision 227/254 — VideoProcessingPollScheduler (apps/api/src/jobs/) needs to
-- write Lesson.captionStatus and LessonContent.videoRef/captionTrackRef from a
-- background job, neither of which ultm8_jobs could do before now:
-- ultm8_jobs already held SELECT+DELETE on Lesson (entity-offboarding purge,
-- 20261112000001) but no UPDATE; LessonContent had no ultm8_jobs grant at all.
-- Least-privilege, same "add only the specific grant a new use actually
-- needs" discipline every prior migration in this schema follows.

GRANT UPDATE ON "Lesson" TO ultm8_jobs;
CREATE POLICY "lesson_jobs_update" ON "Lesson"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);

GRANT SELECT, UPDATE ON "LessonContent" TO ultm8_jobs;
CREATE POLICY "lesson_content_jobs_select" ON "LessonContent"
  FOR SELECT
  TO ultm8_jobs
  USING (true);
CREATE POLICY "lesson_content_jobs_update" ON "LessonContent"
  FOR UPDATE
  TO ultm8_jobs
  USING (true)
  WITH CHECK (true);
