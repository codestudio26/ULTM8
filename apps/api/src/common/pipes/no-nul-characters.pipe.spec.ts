import { BadRequestException } from '@nestjs/common';
import { NoNulCharactersPipe, containsNul } from './no-nul-characters.pipe';
import { isNulCharacterError } from '../filters/http-exception.filter';

const NUL = String.fromCharCode(0);

describe('NoNulCharactersPipe (Decision 433, TXT-4)', () => {
  const pipe = new NoNulCharactersPipe();

  it('finds NUL in strings, nested objects, arrays and keys', () => {
    expect(containsNul(`a${NUL}b`)).toBe(true);
    expect(containsNul({ a: { b: [1, `x${NUL}`] } })).toBe(true);
    expect(containsNul({ [`k${NUL}`]: 'v' })).toBe(true);
    expect(containsNul({ a: 'fine', b: ['ok', 2, null], c: new Date() })).toBe(false);
  });

  it('leaves bytes alone: a raw webhook body or an uploaded file is not text', () => {
    expect(containsNul(Buffer.from([0, 1, 2]))).toBe(false);
    expect(containsNul({ file: Buffer.from([0]) })).toBe(false);
  });

  it('refuses a body, query or route parameter with 400 INVALID_CHARACTER, and skips custom parameters', () => {
    for (const type of ['body', 'query', 'param'] as const) {
      try {
        pipe.transform({ name: `x${NUL}` }, { type });
        throw new Error('not refused');
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_CHARACTER' });
      }
    }
    expect(pipe.transform(`x${NUL}`, { type: 'custom' })).toBe(`x${NUL}`);
    expect(pipe.transform({ name: 'Ana' }, { type: 'body' })).toEqual({ name: 'Ana' });
  });

  it("recognises Postgres's 22021 as Prisma reports it", () => {
    const engine = new Error('ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "22021", message: "invalid byte sequence for encoding \\"UTF8\\": 0x00" }) })');
    expect(isNulCharacterError(engine)).toBe(true);
    expect(isNulCharacterError(new Error('Raw query failed. Code: `22021`.'))).toBe(true);
    expect(isNulCharacterError(new Error('Record 22021 not found'))).toBe(false);
  });
});
