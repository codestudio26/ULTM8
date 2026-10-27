import { videoStateOf } from './cloudflare-stream.service';

/** C5 (Decision 324): when the poll job gives up on a lesson's video. */
describe('videoStateOf', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it('is ready once Stream can play it', () => {
    expect(videoStateOf({ readyToStream: true, status: { state: 'ready' } }, now)).toBe('ready');
  });

  it('keeps waiting while the file uploads or transcodes', () => {
    expect(videoStateOf({ readyToStream: false, status: { state: 'inprogress' } }, now)).toBe('waiting');
    expect(videoStateOf({ readyToStream: false, status: { state: 'pendingupload' }, uploadExpiry: '2026-10-26T13:00:00Z' }, now)).toBe('waiting');
    expect(videoStateOf({ readyToStream: false }, now)).toBe('waiting');
  });

  it('fails when Stream reports an error', () => {
    expect(videoStateOf({ readyToStream: false, status: { state: 'error' } }, now)).toBe('failed');
  });

  it('fails when the upload link expired with no file', () => {
    expect(videoStateOf({ readyToStream: false, status: { state: 'pendingupload' }, uploadExpiry: '2026-10-26T11:00:00Z' }, now)).toBe('failed');
  });
});
