/**
 * Export all signed documents (Decision 315 item 13): the School owner gets a
 * ZIP of every signed waiver at the School (one document per signature, with
 * the drawn signature or paper photo inside it, and index.csv), made by a
 * background job into the private bucket and downloaded through a short-lived
 * signed link. Owner only; this School's signatures only; the ZIP is deleted
 * after 24 hours and with a purged School.
 *
 * R2 is replaced by an in-memory store (the member-files spec's approach),
 * and the queue by a recorder: the spec runs the job itself, so another
 * spec's app (whose worker shares Redis) never picks up these exports.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { R2ClientService } from '../src/common/object-storage/r2-client.service';
import { PrismaJobsService } from '../src/common/prisma/prisma-jobs.service';
import { EntityOffboardingPurgeProcessor } from '../src/jobs/entity-offboarding-purge.processor';
import { SignedDocumentsExportProcessor } from '../src/jobs/signed-documents-export.processor';
import { SIGNED_DOCUMENTS_EXPORT_QUEUE } from '../src/jobs/queue.constants';
import { readZip } from '../src/signed-documents/zip-reader';

const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_URL_APP = process.env.DATABASE_URL_APP;
const DATABASE_URL_JOBS = process.env.DATABASE_URL_JOBS;
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const hasDb = Boolean(DATABASE_URL && DATABASE_URL_APP && DATABASE_URL_JOBS && JWT_ACCESS_SECRET && process.env.QR_STUDENT_TOKEN_SECRET);

const describeIfDb = hasDb ? describe : describe.skip;

if (!hasDb) {
  // eslint-disable-next-line no-console
  console.warn('[signed-documents-export.e2e-spec] Skipped — DATABASE_URL / DATABASE_URL_APP / DATABASE_URL_JOBS / JWT_ACCESS_SECRET not set.');
}

type Role = 'SCHOOL_OWNER_MANAGER' | 'BRANCH_STAFF' | 'INSTRUCTOR' | 'STUDENT';
type Grant = [Role, string, string | null];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

describeIfDb('Export all signed documents (Decision 315 item 13)', () => {
  let app: INestApplication;
  let processor: SignedDocumentsExportProcessor;
  let entityPurge: EntityOffboardingPurgeProcessor;
  const superuser = new PrismaClient({ datasourceUrl: DATABASE_URL });
  const jwt = new JwtService({ secret: JWT_ACCESS_SECRET });

  // The stand-in for the private R2 bucket.
  const stored = new Map<string, Buffer>();
  const r2 = {
    isConfigured: () => true,
    putObject: jest.fn(async (key: string, body: Buffer) => {
      stored.set(key, body);
    }),
    getObject: jest.fn(async (key: string) => stored.get(key) ?? null),
    deleteObject: jest.fn(async (key: string) => {
      stored.delete(key);
    }),
    getPresignedFileDownloadUrl: jest.fn(async (key: string, fileName: string) => `https://r2.example.test/${key}?download=${encodeURIComponent(fileName)}`),
  };

  let queueAdd: jest.SpyInstance;

  const schoolA = randomUUID();
  const schoolB = randomUUID();
  const branchA = randomUUID();
  const schoolIds = [schoolA, schoolB];
  const users: Record<string, { id: string; email: string }> = {};
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({
    get: (path: string) => http().get(path).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) => http().post(path).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const exportsOf = (school = schoolA) => `/v1/schools/${school}/signed-documents/exports`;

  let phone = 0;
  async function mkUser(label: string, grants: Grant[], firstName = label, surname = 'Docs') {
    users[label] = await superuser.user.create({
      data: {
        id: randomUUID(),
        email: `docs-${label}-${randomUUID()}@example.test`,
        phone: `+1556${String(Date.now() % 1_000_000).padStart(6, '0')}${String(phone++).padStart(4, '0')}`,
        firstName,
        surname,
        passcodeHash: 'x',
        dateOfBirth: new Date('1990-01-01'),
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

  const waiverA = randomUUID();
  const waiverA2 = randomUUID();
  const waiverB = randomUUID();

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
    processor = app.get(SignedDocumentsExportProcessor);
    queueAdd = jest.spyOn(app.get<Queue>(getQueueToken(SIGNED_DOCUMENTS_EXPORT_QUEUE)), 'add').mockResolvedValue({} as never);

    const jobsRef = await Test.createTestingModule({
      providers: [EntityOffboardingPurgeProcessor, PrismaJobsService, { provide: R2ClientService, useValue: r2 }],
    }).compile();
    entityPurge = jobsRef.get(EntityOffboardingPurgeProcessor);

    await superuser.school.createMany({ data: [{ id: schoolA, name: 'Docs School A' }, { id: schoolB, name: 'Docs School B' }] });
    await superuser.branch.create({ data: { id: branchA, schoolId: schoolA, name: 'A1' } });
    await mkUser('ownerA', [['SCHOOL_OWNER_MANAGER', schoolA, null]], 'Olivia', 'Owner');
    await mkUser('staffA', [['BRANCH_STAFF', schoolA, branchA]]);
    await mkUser('ownerB', [['SCHOOL_OWNER_MANAGER', schoolB, null]]);
    await mkUser('ana', [['STUDENT', schoolA, null]], 'Ana', 'Lima');
    await mkUser('kid', [['STUDENT', schoolA, null]], 'Kid', 'Lima');
    await mkUser('parent', [], 'Paula', 'Lima');
    await mkUser('ben', [['STUDENT', schoolA, null]], '=Ben', 'Formula');
    await mkUser('bea', [['STUDENT', schoolB, null]], 'Bea', 'Other');

    await superuser.waiver.createMany({
      data: [
        { id: waiverA, schoolId: schoolA, title: 'Liability waiver', body: 'Current text', version: 3 },
        { id: waiverA2, schoolId: schoolA, title: 'Photo consent', body: 'Photos' },
        { id: waiverB, schoolId: schoolB, title: 'School B waiver', body: 'B' },
      ],
    });
    stored.set(`waiver-signatures/${schoolA}/ana.png`, PNG);
    stored.set(`waiver-paper/${schoolA}/ben.jpg`, JPG);
    const day = (d: string) => new Date(`${d}T10:30:00Z`);
    await superuser.waiverSignature.createMany({
      data: [
        // Ana signed online, with a drawn signature.
        {
          id: randomUUID(), waiverId: waiverA, studentId: users.ana.id, schoolId: schoolA, signedById: users.ana.id,
          signerFullName: 'Ana Lima', signatureText: 'Ana Lima', signatureImageKey: `waiver-signatures/${schoolA}/ana.png`,
          signedDate: day('2026-01-10'), status: 'SIGNED', signedWaiverTitle: 'Liability waiver', signedWaiverBody: 'Text <b>v2</b>',
          signedWaiverSha256: 'abc123', signedWaiverVersion: 2,
        },
        // Her Guardian signed for the child.
        {
          id: randomUUID(), waiverId: waiverA, studentId: users.kid.id, schoolId: schoolA, signedById: users.parent.id,
          signerFullName: 'Paula Lima', signatureText: 'Paula Lima', signedDate: day('2026-02-01'), status: 'SIGNED',
          signedWaiverTitle: 'Liability waiver', signedWaiverBody: 'Text v3', signedWaiverSha256: 'def456', signedWaiverVersion: 3,
        },
        // Ben signed on paper (a photo, recorded by the owner); an older one has expired.
        {
          id: randomUUID(), waiverId: waiverA, studentId: users.ben.id, schoolId: schoolA, signedById: null, recordedById: users.ownerA.id,
          method: 'PAPER', signerFullName: 'Ben Formula', signatureImageKey: `waiver-paper/${schoolA}/ben.jpg`,
          signedDate: day('2026-03-01'), status: 'SIGNED',
        },
        {
          id: randomUUID(), waiverId: waiverA2, studentId: users.ben.id, schoolId: schoolA, signedById: users.ben.id,
          signerFullName: 'Ben Formula', signatureText: 'Ben', signatureImageKey: `waiver-signatures/${schoolA}/missing.png`,
          signedDate: day('2025-01-01'), status: 'EXPIRED',
        },
        // Not signed yet: not a document.
        { id: randomUUID(), waiverId: waiverA2, studentId: users.ana.id, schoolId: schoolA, status: 'UNSIGNED' },
        // Another School's signature.
        {
          id: randomUUID(), waiverId: waiverB, studentId: users.bea.id, schoolId: schoolB, signedById: users.bea.id,
          signerFullName: 'Bea Other', signatureText: 'Bea', signedDate: day('2026-01-05'), status: 'SIGNED',
        },
      ],
    });
    await superuser.guestWaiverSignature.create({
      data: {
        id: randomUUID(), schoolId: schoolA, waiverId: waiverA, classTitle: 'Open mat', classStartsAt: day('2026-04-01'),
        guestFullName: 'Gus Guest', guestDateOfBirth: new Date('1995-05-05'), signerFullName: 'Gus Guest', signatureText: 'Gus',
        signedByGuardian: false, signedWaiverTitle: 'Liability waiver', signedWaiverBody: 'Text v3', signedWaiverSha256: 'ghi789',
        signedWaiverVersion: 3, signedAt: day('2026-04-01'),
      },
    });
  });

  afterAll(async () => {
    await superuser.signedDocumentExport.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.guestWaiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiverSignature.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.waiver.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.studentJoinDate.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.roleGrant.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await superuser.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
    await superuser.school.deleteMany({ where: { id: { in: schoolIds } } });
    await superuser.$disconnect();
    await app.close();
  });

  let exportId: string;

  /** Runs the job for an export, as the worker would, and returns where it ended. */
  async function settle(id: string): Promise<string> {
    await processor.run(id);
    for (let i = 0; i < 100; i++) {
      const row = await superuser.signedDocumentExport.findUniqueOrThrow({ where: { id } });
      if (row.status !== 'PENDING' && row.status !== 'RUNNING') return row.status;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Export ${id} did not finish.`);
  }

  it('only the School owner may export: Branch Staff, a student and another School’s owner are refused', async () => {
    expect((await as('staffA').post(exportsOf()).send({})).status).toBe(403);
    expect((await as('ana').post(exportsOf()).send({})).status).toBe(403);
    expect((await as('ownerB').post(exportsOf()).send({})).status).toBe(403);
    expect((await as('ownerB').get(`${exportsOf()}/latest`)).status).toBe(403);
    expect(await superuser.signedDocumentExport.count({ where: { schoolId: schoolA } })).toBe(0);
  });

  it('the owner starts an export; asking again while it is being made returns the same one', async () => {
    const res = await as('ownerA')
      .post(exportsOf())
      .send({ labels: { member: 'Membro', document: 'Documento', signedBy: 'Assinado por', guardian: 'Responsável' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', documentCount: null, requestedByName: 'Olivia Owner' });
    exportId = res.body.id;
    expect(queueAdd).toHaveBeenCalledWith('export', { exportId }, expect.objectContaining({ jobId: `signed-documents-export-${exportId}` }));
    const again = await as('ownerA').post(exportsOf()).send({});
    expect(again.body.id).toBe(exportId);
    // Labels are short text only.
    expect((await as('ownerA').post(exportsOf()).send({ labels: { member: 'x'.repeat(201) } })).status).toBe(400);
  });

  it('the job builds a ZIP of every signed document at the School, with an index, into the private bucket', async () => {
    expect(await settle(exportId)).toBe('READY');
    // Running it again does nothing.
    expect(await processor.run(exportId)).toBe('READY');

    const res = await as('ownerA').get(`${exportsOf()}/${exportId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: exportId, status: 'READY', documentCount: 5 });
    expect(new Date(res.body.expiresAt).getTime() - new Date(res.body.finishedAt).getTime()).toBe(24 * 60 * 60 * 1000);
    expect((await as('ownerA').get(`${exportsOf()}/latest`)).body.export.id).toBe(exportId);

    const row = await superuser.signedDocumentExport.findUniqueOrThrow({ where: { id: exportId } });
    expect(row.objectKey).toBe(`signed-document-exports/${schoolA}/${exportId}.zip`);
    const files = readZip(stored.get(row.objectKey!)!);
    expect(res.body.sizeBytes).toBe(stored.get(row.objectKey!)!.length);

    const names = [...files.keys()];
    expect(names).toHaveLength(6);
    expect(names[5]).toBe('index.csv');
    expect(names.slice(0, 5)).toEqual([
      'documents/00001 =Ben Formula - Photo consent.html',
      'documents/00002 Ana Lima - Liability waiver.html',
      'documents/00003 Kid Lima - Liability waiver.html',
      'documents/00004 =Ben Formula - Liability waiver.html',
      'documents/00005 Gus Guest - Liability waiver.html',
    ]);

    const csv = files.get('index.csv')!.toString('utf8');
    expect(csv.startsWith('\ufeff')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    // The portal's words, English for the ones it left out.
    expect(lines[0]).toBe('Membro,Documento,Version,Signed at,Assinado por,File');
    expect(lines).toEqual([
      lines[0],
      "'=Ben Formula,Photo consent (Expired),,2025-01-01 10:30 UTC,Ben Formula,documents/00001 =Ben Formula - Photo consent.html",
      'Ana Lima,Liability waiver,2,2026-01-10 10:30 UTC,Ana Lima,documents/00002 Ana Lima - Liability waiver.html',
      'Kid Lima,Liability waiver,3,2026-02-01 10:30 UTC,Paula Lima (Responsável),documents/00003 Kid Lima - Liability waiver.html',
      "'=Ben Formula,Liability waiver,,2026-03-01 10:30 UTC,Ben Formula (On paper),documents/00004 =Ben Formula - Liability waiver.html",
      'Gus Guest (Guest),Liability waiver,3,2026-04-01 10:30 UTC,Gus Guest,documents/00005 Gus Guest - Liability waiver.html',
    ]);
    // Another School's signature and an unsigned row are not in it.
    expect(csv).not.toContain('Bea');
    expect(csv.split('Photo consent').length - 1).toBe(2);

    const ana = files.get('documents/00002 Ana Lima - Liability waiver.html')!.toString('utf8');
    expect(ana).toContain('Docs School A');
    expect(ana).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
    expect(ana).toContain('Text &lt;b&gt;v2&lt;/b&gt;'); // the wording as signed, escaped
    expect(ana).not.toContain('Current text');
    expect(ana).toContain('abc123');
    const paper = files.get('documents/00004 =Ben Formula - Liability waiver.html')!.toString('utf8');
    expect(paper).toContain(`src="data:image/jpeg;base64,${JPG.toString('base64')}"`);
    expect(paper).toContain('Olivia Owner'); // recorded by
    expect(paper).toContain("The wording signed wasn't kept for this signature.".replace("'", '&#39;'));
    const expired = files.get('documents/00001 =Ben Formula - Photo consent.html')!.toString('utf8');
    expect(expired).toContain("The signature image couldn&#39;t be found.");
  });

  it('the owner downloads it through a short-lived signed link; nobody else can', async () => {
    const res = await as('ownerA').get(`${exportsOf()}/${exportId}/download`);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(new RegExp(`^https://r2\\.example\\.test/signed-document-exports/${schoolA}/${exportId}\\.zip\\?download=signed-documents-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    expect(r2.getPresignedFileDownloadUrl).toHaveBeenLastCalledWith(`signed-document-exports/${schoolA}/${exportId}.zip`, expect.stringMatching(/^signed-documents-.*\.zip$/), 'application/zip');

    expect((await as('staffA').get(`${exportsOf()}/${exportId}/download`)).status).toBe(403);
    expect((await as('ownerB').get(`${exportsOf()}/${exportId}/download`)).status).toBe(403);
    // Through School B's own path, School A's export doesn't exist.
    const viaB = await as('ownerB').get(`${exportsOf(schoolB)}/${exportId}/download`);
    expect(viaB.status).toBe(404);
    expect((await as('ownerB').get(`${exportsOf(schoolB)}/${exportId}`)).status).toBe(404);
  });

  it("School B's export holds School B's signatures only", async () => {
    const res = await as('ownerB').post(exportsOf(schoolB)).send({});
    expect(await settle(res.body.id)).toBe('READY');
    const row = await superuser.signedDocumentExport.findUniqueOrThrow({ where: { id: res.body.id } });
    const files = readZip(stored.get(row.objectKey!)!);
    expect([...files.keys()]).toEqual(['documents/00001 Bea Other - School B waiver.html', 'index.csv']);
    expect(files.get('index.csv')!.toString('utf8')).not.toContain('Ana');
  });

  it('the ZIP is deleted 24 hours after it was made; the record of the export stays', async () => {
    const key = `signed-document-exports/${schoolA}/${exportId}.zip`;
    await entityPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect(stored.has(key)).toBe(true);

    await superuser.signedDocumentExport.update({ where: { id: exportId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // Past its time it reads as expired at once, and can't be downloaded.
    expect((await as('ownerA').get(`${exportsOf()}/${exportId}`)).body.status).toBe('EXPIRED');
    expect((await as('ownerA').get(`${exportsOf()}/${exportId}/download`)).status).toBe(409);

    await entityPurge.process({ data: {}, attemptsMade: 1, opts: { attempts: 3 } } as never);
    expect(stored.has(key)).toBe(false);
    expect(await superuser.signedDocumentExport.findUnique({ where: { id: exportId } })).toMatchObject({ status: 'EXPIRED', objectKey: null });

    // A new export can be asked for.
    const next = await as('ownerA').post(exportsOf()).send({});
    expect(next.status).toBe(201);
    expect(next.body.id).not.toBe(exportId);
    expect(await settle(next.body.id)).toBe('READY');
  });

  it('an export whose building fails is marked FAILED, and the owner can ask again', async () => {
    r2.putObject.mockRejectedValueOnce(new Error('R2 is down'));
    const res = await as('ownerA').post(exportsOf()).send({});
    expect(res.status).toBe(201);
    expect(await settle(res.body.id)).toBe('FAILED');
    expect((await as('ownerA').get(`${exportsOf()}/${res.body.id}`)).body.status).toBe('FAILED');
    expect((await as('ownerA').get(`${exportsOf()}/${res.body.id}/download`)).status).toBe(409);
    const again = await as('ownerA').post(exportsOf()).send({});
    expect(again.body.id).not.toBe(res.body.id);
    expect(await settle(again.body.id)).toBe('READY');
  });
});
