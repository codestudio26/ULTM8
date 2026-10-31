/**
 * Files on a member (backlog 5.11; Decision 315 item 9): PDF, JPG and PNG, up
 * to 10 MB each, seen by the owner and the Branch Staff the owner switches on
 * ("See and manage member files", for their own branches' students); never
 * shown to the member; erased with the account and with a purged School.
 *
 * R2 is replaced by an in-memory store (the purge specs' approach), so the
 * stored copy can be checked without a real bucket.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';
import { TenantLifecyclePurgeProcessor } from '../src/jobs/tenant-lifecycle-purge.processor';
import { MEMBER_FILE_MAX_BYTES } from '../src/member-files/member-file-type';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[member-files.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';
type Grant = [Role, string, string | null];

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 0x20)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const ACCESS_DEFAULTS = {
  classes: false,
  bookings: true,
  students: true,
  cancelClasses: true,
  staffList: false,
  inviteCoaches: false,
  disciplines: false,
  checkInRules: false,
  exportStudents: false,
  freezeMemberships: false,
  memberFiles: false,
};

describeIfDb('Files on a member (backlog 5.11)', () => {
  let app: INestApplication;
  let entityPurge: EntityOffboardingPurgeProcessor;
  let tenantPurge: TenantLifecyclePurgeProcessor;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  // The stand-in for the private R2 bucket.
  const stored = new Map<string, Buffer>();
  let failDeletes = false;
  const r2 = {
    isConfigured: () => true,
    putObject: jest.fn(async (key: string, body: Buffer) => {
      stored.set(key, body);
    }),
    deleteObject: jest.fn(async (key: string) => {
      if (failDeletes) throw new Error('R2 is down');
      stored.delete(key);
    }),
    getPresignedFileDownloadUrl: jest.fn(async (key: string, fileName: string) => `https://r2.example.test/${key}?download=${encodeURIComponent(fileName)}`),
  };

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const branchA1 = randomUUID();
  const branchA2 = randomUUID();
  const schoolIds = [schoolA, schoolB];
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
    put: (path: string) => http().put(path).set('Authorization', `Bearer ${tokens[who]}`),
    delete: (path: string) => http().delete(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const filesOf = (studentId: string, school = schoolA) => `/v1/schools/${school}/students/${studentId}/files`;
  const upload = (who: string, studentId: string, body: Buffer, filename: string, school = schoolA) =>
    as(who).post(filesOf(studentId, school)).attach('file', body, { filename, contentType: 'application/octet-stream' });

  async function mkUser(label: string, grants: Grant[], dateOfBirth = '1990-01-01') {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `files-${label}-${randomUUID()}@example.test`,
        phone: `+1555${Math.floor(1_000_000_000 + Math.random() * 9_000_000_000)}`,
        firstName: label,
        surname: 'Files',
        passcodeHash: 'x',
        dateOfBirth: new Date(dateOfBirth),
        phoneVerifiedAt: new Date(),
      },
    });
    for (const [role, sid, branchId] of grants) {
      await superuser.roleGrant.create({ data: { id: randomUUID(), role, userId: users[label].id, schoolId: sid, branchId, isMainOwner: role === 'SCHOOL_OWNER_MANAGER' } });
    }
    tokens[label] = jwt.sign({
      sub: users[label].id,
      email: users[label].email,
      grants: grants.map(([role, sid, branchId]) => ({ role, franchiseId: null, schoolId: sid, branchId })),
    });
    return users[label];
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(R2ClientService)
      .useValue(r2)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    const jobsRef = await Test.createTestingModule({
      providers: [EntityOffboardingPurgeProcessor, TenantLifecyclePurgeProcessor, PrismaJobsService, { provide: R2ClientService, useValue: r2 }],
    }).compile();
    entityPurge = jobsRef.get(EntityOffboardingPurgeProcessor);
    tenantPurge = jobsRef.get(TenantLifecyclePurgeProcessor);

    await superuser.school.createMany({ data: [{ id: schoolA, name: 'Files School A' }, { id: schoolB, name: 'Files School B' }] });
    await superuser.branch.createMany({
      data: [
        { id: branchA1, schoolId: schoolA, name: 'A1' },
        { id: branchA2, schoolId: schoolA, name: 'A2' },
      ],
    });
    await mkUser('ownerA', [['SCHOOL_OWNER_MANAGER', schoolA, null]]);
    await mkUser('staffA1', [['BRANCH_STAFF', schoolA, branchA1]]);
    await mkUser('coachA', [['INSTRUCTOR', schoolA, branchA1]]);
    await mkUser('ana', [['STUDENT', schoolA, null]]);
    await mkUser('ben', [['STUDENT', schoolA, null]]);
    await mkUser('kid', [['STUDENT', schoolA, null]], '2016-01-01');
    await mkUser('parent', []);
    await mkUser('outsider', []);
    await mkUser('ownerB', [['SCHOOL_OWNER_MANAGER', schoolB, null]]);
    await mkUser('bea', [['STUDENT', schoolB, null]]);
    await superuser.studentHomeBranch.createMany({
      data: [
        { id: randomUUID(), schoolId: schoolA, studentId: users.ana.id, branchId: branchA1 },
        { id: randomUUID(), schoolId: schoolA, studentId: users.kid.id, branchId: branchA1 },
        { id: randomUUID(), schoolId: schoolA, studentId: users.ben.id, branchId: branchA2 },
      ],
    });
    await superuser.guardianLink.create({ data: { id: randomUUID(), guardianId: users.parent.id, studentId: users.kid.id } });
  });

  afterAll(async () => {
    await superuser.memberFile.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffActivity.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.staffPermission.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guardianLink.deleteMany({ where: { studentId: users.kid.id } });
    await superuser.studentHomeBranch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  it('the owner uploads a PDF, JPG and PNG; the list shows name, size, date and who uploaded, newest first', async () => {
    const pdf = await upload('ownerA', users.ana.id, PDF, 'Medical certificate.pdf');
    expect(pdf.status).toBe(201);
    expect(pdf.body).toMatchObject({ fileName: 'Medical certificate.pdf', contentType: 'application/pdf', sizeBytes: PDF.length, uploadedByName: 'ownerA Files' });
    expect((await upload('ownerA', users.ana.id, JPG, 'photo ID.JPEG')).body.contentType).toBe('image/jpeg');
    expect((await upload('ownerA', users.ana.id, PNG, 'scan.png')).body.contentType).toBe('image/png');

    const row = await superuser.memberFile.findUniqueOrThrow({ where: { id: pdf.body.id } });
    expect(row.objectKey).toMatch(new RegExp(`^member-files/${schoolA}/${users.ana.id}/${row.id}\\.pdf$`));
    expect(stored.get(row.objectKey)?.equals(PDF)).toBe(true);
    expect(r2.putObject).toHaveBeenCalledWith(row.objectKey, expect.any(Buffer), 'application/pdf');

    const list = await as('ownerA').get(filesOf(users.ana.id));
    expect(list.status).toBe(200);
    expect(list.body.items.map((f: { fileName: string }) => f.fileName)).toEqual(['scan.png', 'photo ID.JPEG', 'Medical certificate.pdf']);
    expect(Object.keys(list.body.items[0]).sort()).toEqual(['contentType', 'createdAt', 'fileName', 'id', 'sizeBytes', 'uploadedByName']);
  });

  it('the type is read from the content, the name must agree, and the 10 MB limit is checked by the server', async () => {
    const before = await superuser.memberFile.count({ where: { studentId: users.ana.id } });
    const renamed = await upload('ownerA', users.ana.id, PNG, 'contract.pdf');
    expect(renamed.status).toBe(400);
    expect(JSON.stringify(renamed.body)).toContain('Only PDF, JPG and PNG files can be uploaded.');
    expect((await upload('ownerA', users.ana.id, Buffer.from('<script>alert(1)</script>'), 'notes.pdf')).status).toBe(400);
    expect((await upload('ownerA', users.ana.id, Buffer.from('GIF89a......'), 'anim.gif')).status).toBe(400);
    expect((await upload('ownerA', users.ana.id, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14]), 'form.docx')).status).toBe(400);
    const noFile = await as('ownerA').post(filesOf(users.ana.id));
    expect(noFile.status).toBe(400);
    expect(JSON.stringify(noFile.body)).toContain('Choose a file to upload.');

    const tooBig = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(MEMBER_FILE_MAX_BYTES - 8, 0x20)]);
    expect(tooBig.length).toBe(MEMBER_FILE_MAX_BYTES + 1);
    expect((await upload('ownerA', users.ana.id, tooBig, 'big.pdf')).status).toBe(413);
    const justFits = await upload('ownerA', users.ana.id, tooBig.subarray(0, MEMBER_FILE_MAX_BYTES), 'fits.pdf');
    expect(justFits.status).toBe(201);
    expect(justFits.body.sizeBytes).toBe(MEMBER_FILE_MAX_BYTES);
    expect(await superuser.memberFile.count({ where: { studentId: users.ana.id } })).toBe(before + 1);
    await as('ownerA').delete(`${filesOf(users.ana.id)}/${justFits.body.id}`);
  });

  it('files go only on a current student of the School', async () => {
    const res = await upload('ownerA', users.outsider.id, PDF, 'x.pdf');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('This person is not a Student at this School.');
    expect((await upload('ownerA', users.bea.id, PDF, 'x.pdf')).status).toBe(404);
  });

  it('download is a short-lived signed link with the file name, never a public URL', async () => {
    const file = (await as('ownerA').get(filesOf(users.ana.id))).body.items.find((f: { fileName: string }) => f.fileName === 'Medical certificate.pdf');
    const res = await as('ownerA').get(`${filesOf(users.ana.id)}/${file.id}/download`);
    expect(res.status).toBe(200);
    const row = await superuser.memberFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(res.body).toEqual({ url: `https://r2.example.test/${row.objectKey}?download=${encodeURIComponent('Medical certificate.pdf')}` });
    expect(r2.getPresignedFileDownloadUrl).toHaveBeenCalledWith(row.objectKey, 'Medical certificate.pdf', 'application/pdf');
    expect((await as('ownerA').get(`${filesOf(users.ana.id)}/${randomUUID()}/download`)).status).toBe(404);
    // Another student's path doesn't reach this file.
    expect((await as('ownerA').get(`${filesOf(users.ben.id)}/${file.id}/download`)).status).toBe(404);
  });

  it('Branch Staff need the switch, then see their own branches\' students only; coaches never', async () => {
    const off = await as('staffA1').get(filesOf(users.ana.id));
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('STAFF_ACCESS_OFF');
    expect((await upload('staffA1', users.ana.id, PDF, 'x.pdf')).status).toBe(403);
    expect((await as('staffA1').get(`/v1/schools/${schoolA}/staff/me/access`)).body.access.memberFiles).toBe(false);
    expect((await as('coachA').get(filesOf(users.ana.id))).status).toBe(403);

    const put = await as('ownerA').put(`/v1/schools/${schoolA}/staff/${users.staffA1.id}/access`).send({ ...ACCESS_DEFAULTS, memberFiles: true });
    expect(put.status).toBe(200);
    expect((await as('staffA1').get(`/v1/schools/${schoolA}/staff/me/access`)).body.access.memberFiles).toBe(true);
    const logged = await superuser.staffActivity.findFirstOrThrow({ where: { schoolId: schoolA, targetUserId: users.staffA1.id, action: 'ACCESS_CHANGED' } });
    expect(logged.details).toEqual({ changes: [{ switch: 'memberFiles', on: true }] });

    expect((await as('staffA1').get(filesOf(users.ana.id))).body.items).toHaveLength(3);
    const mine = await upload('staffA1', users.ana.id, PDF, 'Staff upload.pdf');
    expect(mine.status).toBe(201);
    expect(mine.body.uploadedByName).toBe('staffA1 Files');
    // Staff with the switch may also delete, including the owner's files.
    expect((await as('staffA1').delete(`${filesOf(users.ana.id)}/${mine.body.id}`)).status).toBe(204);
    // Ben's home branch is A2: not theirs.
    expect((await as('staffA1').get(filesOf(users.ben.id))).status).toBe(403);
    expect((await upload('staffA1', users.ben.id, PDF, 'x.pdf')).status).toBe(403);
    // Coaches have no switch and stay out.
    expect((await as('coachA').get(filesOf(users.ana.id))).status).toBe(403);
  });

  it('never shown to the member: the student and a Guardian are refused, and no member-facing read carries a file', async () => {
    await upload('ownerA', users.kid.id, PDF, 'Kid consent form.pdf');
    const anaFile = (await as('ownerA').get(filesOf(users.ana.id))).body.items[0];
    expect((await as('ana').get(filesOf(users.ana.id))).status).toBe(403);
    expect((await as('ana').get(`${filesOf(users.ana.id)}/${anaFile.id}/download`)).status).toBe(403);
    expect((await upload('ana', users.ana.id, PDF, 'x.pdf')).status).toBe(403);
    expect((await as('ana').delete(`${filesOf(users.ana.id)}/${anaFile.id}`)).status).toBe(403);
    expect((await as('parent').get(filesOf(users.kid.id))).status).toBe(403);

    const markers = [...(await superuser.memberFile.findMany({ where: { studentId: { in: [users.ana.id, users.kid.id] } } }))].flatMap((f) => [f.id, f.fileName, f.objectKey]);
    expect(markers.length).toBeGreaterThan(0);
    const reads: Array<[string, string]> = [
      ['ana', '/v1/users/me'],
      ['ana', '/v1/student-notes/me'],
      ['ana', '/v1/memberships/me'],
      ['ana', '/v1/waivers/me'],
      ['ana', '/v1/membership-cards/me'],
      ['ana', '/v1/rank-corrections/me'],
      ['ana', '/v1/transactions/me'],
      ['parent', '/v1/users/me'],
      ['parent', `/v1/student-notes/me?studentId=${users.kid.id}`],
    ];
    for (const [who, path] of reads) {
      const res = await as(who).get(path);
      expect([path, res.status]).toEqual([path, 200]);
      const body = JSON.stringify(res.body);
      for (const marker of markers) expect([path, body.includes(marker)]).toEqual([path, false]);
    }
    expect((await as('ana').get('/v1/users/me')).status).toBe(200);
  });

  it("School A's staff can't list, download or delete School B's files", async () => {
    const beaFile = await upload('ownerB', users.bea.id, PDF, 'B private.pdf', schoolB);
    expect(beaFile.status).toBe(201);
    const id = beaFile.body.id;
    // Through School B's paths: not their School.
    for (const who of ['ownerA', 'staffA1']) {
      expect((await as(who).get(filesOf(users.bea.id, schoolB))).status).toBe(403);
      expect((await as(who).get(`${filesOf(users.bea.id, schoolB)}/${id}/download`)).status).toBe(403);
      expect((await as(who).delete(`${filesOf(users.bea.id, schoolB)}/${id}`)).status).toBe(403);
      expect((await upload(who, users.bea.id, PDF, 'x.pdf', schoolB)).status).toBe(403);
    }
    // Through their own School's paths: no such file there.
    expect((await as('ownerA').get(filesOf(users.bea.id))).body.items).toEqual([]);
    expect((await as('ownerA').get(`${filesOf(users.bea.id)}/${id}/download`)).status).toBe(404);
    expect((await as('ownerA').delete(`${filesOf(users.bea.id)}/${id}`)).status).toBe(404);
    expect((await as('ownerA').get(`${filesOf(users.ana.id)}/${id}/download`)).status).toBe(404);
    expect(await superuser.memberFile.count({ where: { id } })).toBe(1);
  });

  it('delete removes the stored file first; if storage fails the record stays and nothing is lost', async () => {
    const file = (await upload('ownerA', users.ana.id, PNG, 'to delete.png')).body;
    const { objectKey } = await superuser.memberFile.findUniqueOrThrow({ where: { id: file.id } });
    failDeletes = true;
    const failed = await as('ownerA').delete(`${filesOf(users.ana.id)}/${file.id}`);
    failDeletes = false;
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).toContain("The file couldn't be deleted. Try again.");
    expect(await superuser.memberFile.count({ where: { id: file.id } })).toBe(1);
    expect(stored.has(objectKey)).toBe(true);

    expect((await as('ownerA').delete(`${filesOf(users.ana.id)}/${file.id}`)).status).toBe(204);
    expect(await superuser.memberFile.count({ where: { id: file.id } })).toBe(0);
    expect(stored.has(objectKey)).toBe(false);
    expect((await as('ownerA').delete(`${filesOf(users.ana.id)}/${file.id}`)).status).toBe(404);
  });

  it("erased with the account: the account's deletion leaves the files ownerless, and the daily purge deletes the stored files, then the rows", async () => {
    const leaver = await mkUser('leaver', [['STUDENT', schoolA, null]]);
    const a = (await upload('ownerA', leaver.id, PDF, 'leaver.pdf')).body;
    const b = (await upload('ownerA', leaver.id, JPG, 'leaver.jpg')).body;
    const keys = (await superuser.memberFile.findMany({ where: { id: { in: [a.id, b.id] } } })).map((f) => f.objectKey);
    expect(keys.every((k) => stored.has(k))).toBe(true);
    const anaFiles = await superuser.memberFile.count({ where: { studentId: users.ana.id } });

    // The account is erased.
    await superuser.roleGrant.deleteMany({ where: { userId: leaver.id } });
    await superuser.user.delete({ where: { id: leaver.id } });
    delete users.leaver;
    expect(await superuser.memberFile.count({ where: { id: { in: [a.id, b.id] }, studentId: null } })).toBe(2);

    // Storage down: nothing is lost, both are tried again next time.
    failDeletes = true;
    await entityPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    failDeletes = false;
    expect(await superuser.memberFile.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);

    await entityPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect(await superuser.memberFile.count({ where: { id: { in: [a.id, b.id] } } })).toBe(0);
    expect(keys.some((k) => stored.has(k))).toBe(false);
    // Other members' files are untouched.
    expect(await superuser.memberFile.count({ where: { studentId: users.ana.id } })).toBe(anaFiles);
  });

  it("a purged School's files are deleted (stored copies and rows) before the School goes; until storage works the School waits", async () => {
    const closing = randomUUID();
    schoolIds.push(closing);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await superuser.school.create({ data: { id: closing, name: 'Files Closing School' } });
    await mkUser('closingOwner', [['SCHOOL_OWNER_MANAGER', closing, null]]);
    await mkUser('closingStudent', [['STUDENT', closing, null]]);
    const file = (await upload('closingOwner', users.closingStudent.id, PDF, 'closing.pdf', closing)).body;
    const { objectKey } = await superuser.memberFile.findUniqueOrThrow({ where: { id: file.id } });
    await superuser.school.update({ where: { id: closing }, data: { archivedAt: past, purgeAt: past } });

    failDeletes = true;
    await tenantPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    failDeletes = false;
    expect(await superuser.school.count({ where: { id: closing } })).toBe(1);
    expect(await superuser.memberFile.count({ where: { id: file.id } })).toBe(1);
    expect(stored.has(objectKey)).toBe(true);

    await superuser.roleGrant.deleteMany({ where: { schoolId: closing } });
    await tenantPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect(await superuser.school.count({ where: { id: closing } })).toBe(0);
    expect(await superuser.memberFile.count({ where: { id: file.id } })).toBe(0);
    expect(stored.has(objectKey)).toBe(false);
    // The other Schools' files are untouched.
    expect(await superuser.memberFile.count({ where: { schoolId: schoolB } })).toBe(1);
  });
});
