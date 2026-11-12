import { ForbiddenException } from '@nestjs/common';
import { GradingService } from './grading.service';

/**
 * The Dashboard's "Ready to grade" list (GradingService.getReadyToGrade,
 * Decision 454 item 8): it is the Grading Board's own Ready to Grade column,
 * read through getGradingBoard with "Currently attending only" on, across the
 * styles the caller grades. The same against a real Postgres (who sees which
 * Branch's students, another School beside it) is in
 * test/dashboard-tiles.e2e-spec.ts.
 */
describe('GradingService.getReadyToGrade (Ready to grade)', () => {
  const SCHOOL = '11111111-1111-4111-8111-111111111111';
  const STYLES = [
    { id: 'bjj', name: 'BJJ' },
    { id: 'judo', name: 'Judo' },
  ];

  type Column = 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';
  const card = (studentId: string, column: Column, progressPercent: number, surname = 'Lee') => ({
    studentId,
    firstName: studentId,
    surname,
    currentStripeId: `${studentId}-rung`,
    photoUrl: null,
    eligibility: { hasNext: true, boardColumn: column, progressPercent, nextRungId: `${studentId}-next` },
  });

  function make(opts: { owner: boolean; permitted?: string[]; boards: Record<string, ReturnType<typeof card>[]> }) {
    const tx = {
      discipline: { findMany: jest.fn().mockResolvedValue(STYLES) },
      gradingPermission: { findMany: jest.fn().mockResolvedValue((opts.permitted ?? []).map((disciplineId) => ({ disciplineId }))) },
    };
    const prismaApp = { withTenantContext: jest.fn((_userId: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    const tenantAuth = {
      isSchoolOwner: jest.fn().mockResolvedValue(opts.owner),
      assertStaffAtSchool: jest.fn().mockResolvedValue(undefined),
    };
    const service = new GradingService(prismaApp as never, tenantAuth as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const board = jest
      .spyOn(service, 'getGradingBoard')
      .mockImplementation(async (_caller, _school, disciplineId) => ({ items: opts.boards[disciplineId] ?? [], hiddenInactive: 0, atTopRank: 0 }) as never);
    return { service, tx, tenantAuth, board };
  }

  it('lists only the Ready to Grade column, highest progress first, from each board read with "Currently attending only" on', async () => {
    const t = make({
      owner: true,
      boards: {
        bjj: [card('ana', 'READY_TO_GRADE', 100), card('ben', 'GETTING_THERE', 50), card('cara', 'JUST_STARTING', 10)],
        judo: [card('dan', 'READY_TO_GRADE', 80), card('eve', 'READY_TO_GRADE', 100, 'Abe')],
      },
    });
    const res = await t.service.getReadyToGrade('owner', SCHOOL);
    expect(res.total).toBe(3);
    expect(res.items.map((i) => [i.studentId, i.disciplineId])).toEqual([
      ['eve', 'judo'],
      ['ana', 'bjj'],
      ['dan', 'judo'],
    ]);
    expect(res.items[1]).toEqual({
      studentId: 'ana',
      firstName: 'ana',
      surname: 'Lee',
      photoUrl: null,
      disciplineId: 'bjj',
      disciplineName: 'BJJ',
      currentStripeId: 'ana-rung',
      nextRungId: 'ana-next',
      progressPercent: 100,
    });
    // Inactive students are left out by the board itself (activeOnly), as on the Grading Board.
    for (const call of t.board.mock.calls) expect(call[3]).toEqual({ activeOnly: true });
    expect(t.board.mock.calls.map((c) => c[2])).toEqual(['bjj', 'judo']);
  });

  it('reads open styles only (archived styles are not graded)', async () => {
    const t = make({ owner: true, boards: {} });
    await t.service.getReadyToGrade('owner', SCHOOL);
    expect(t.tx.discipline.findMany.mock.calls[0][0]).toMatchObject({ where: { schoolId: SCHOOL, archivedAt: null } });
  });

  it('a Getting There or Just Starting student is never listed, even at a high %', async () => {
    const t = make({ owner: true, boards: { bjj: [card('ben', 'GETTING_THERE', 65)], judo: [] } });
    expect(await t.service.getReadyToGrade('owner', SCHOOL)).toEqual({ total: 0, items: [] });
  });

  it('Branch Staff and coaches: only the styles they hold a grading permission for (the board scopes the students)', async () => {
    const t = make({ owner: false, permitted: ['judo'], boards: { bjj: [card('ana', 'READY_TO_GRADE', 100)], judo: [card('dan', 'READY_TO_GRADE', 90)] } });
    const res = await t.service.getReadyToGrade('coach', SCHOOL);
    expect(t.tenantAuth.assertStaffAtSchool).toHaveBeenCalledWith('coach', SCHOOL);
    expect(t.tx.gradingPermission.findMany.mock.calls[0][0]).toMatchObject({ where: { schoolId: SCHOOL, userId: 'coach' } });
    expect(t.board.mock.calls.map((c) => c[2])).toEqual(['judo']);
    expect(res.items.map((i) => i.studentId)).toEqual(['dan']);
  });

  it('staff with no grading permission get an empty list, and no board is read', async () => {
    const t = make({ owner: false, permitted: [], boards: { bjj: [card('ana', 'READY_TO_GRADE', 100)] } });
    expect(await t.service.getReadyToGrade('coach', SCHOOL)).toEqual({ total: 0, items: [] });
    expect(t.board).not.toHaveBeenCalled();
  });

  it('someone who is not staff at the School is refused before anything is read', async () => {
    const t = make({ owner: false, boards: {} });
    t.tenantAuth.assertStaffAtSchool.mockRejectedValue(new ForbiddenException());
    await expect(t.service.getReadyToGrade('student', SCHOOL)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.tx.discipline.findMany).not.toHaveBeenCalled();
    expect(t.board).not.toHaveBeenCalled();
  });
});
