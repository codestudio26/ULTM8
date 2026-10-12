import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoUploadField } from './components';

/** jsdom has no real `URL.createObjectURL`/`revokeObjectURL` — stubbed here
 * rather than left to throw, same reasoning any other jsdom-missing-browser-API
 * test in this package would need. */
beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-preview'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeFile(name: string, type: string, sizeBytes: number): File {
  const file = new File([new Uint8Array(sizeBytes)], name, { type });
  return file;
}

describe('PhotoUploadField', () => {
  it('renders the current value as the preview image when no file has been picked', () => {
    render(
      <PhotoUploadField
        value="https://cdn.example.test/public-photos/instructor/s1/i1/a.jpg"
        onChange={vi.fn()}
        requestUpload={vi.fn()}
      />,
    );
    const img = screen.getByRole('img', { name: /current photo/i });
    expect(img).toHaveAttribute('src', 'https://cdn.example.test/public-photos/instructor/s1/i1/a.jpg');
    expect(screen.getByRole('button', { name: /change photo/i })).toBeInTheDocument();
  });

  it('shows no preview image and an "Upload photo" button when value is empty', () => {
    render(<PhotoUploadField value="" onChange={vi.fn()} requestUpload={vi.fn()} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload photo/i })).toBeInTheDocument();
  });

  it('picking a valid file requests an upload URL, PUTs the file, and calls onChange with the publicUrl', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const requestUpload = vi.fn().mockResolvedValue({
      uploadUrl: 'https://r2.example.test/presigned-put',
      publicUrl: 'https://cdn.example.test/public-photos/instructor/s1/i1/new.png',
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(<PhotoUploadField value="" onChange={onChange} requestUpload={requestUpload} />);
    const file = makeFile('photo.png', 'image/png', 1024);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://cdn.example.test/public-photos/instructor/s1/i1/new.png'));
    expect(requestUpload).toHaveBeenCalledWith(file);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example.test/presigned-put',
      expect.objectContaining({ method: 'PUT', headers: { 'Content-Type': 'image/png' } }),
    );
  });

  it('rejects a non-image file before ever calling requestUpload', async () => {
    // `fireEvent.change` (not `userEvent.upload`) deliberately bypasses the
    // `accept` attribute's own OS-picker-level filtering — the real browser
    // would never let a file arrive this way via the picker, but a drag-and-
    // drop (which does NOT respect `accept`) could, so this component's own
    // MIME check is real defense-in-depth worth testing directly.
    const requestUpload = vi.fn();
    render(<PhotoUploadField value="" onChange={vi.fn()} requestUpload={requestUpload} />);
    const file = makeFile('doc.pdf', 'application/pdf', 1024);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, or WebP/i);
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('rejects a file over the max size before ever calling requestUpload', async () => {
    const user = userEvent.setup();
    const requestUpload = vi.fn();
    render(<PhotoUploadField value="" onChange={vi.fn()} requestUpload={requestUpload} maxSizeBytes={1000} />);
    const file = makeFile('big.png', 'image/png', 2000);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/i);
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('a failed PUT shows an error and never calls onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const requestUpload = vi.fn().mockResolvedValue({ uploadUrl: 'https://r2.example.test/presigned-put', publicUrl: 'https://cdn.example.test/x.png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    render(<PhotoUploadField value="" onChange={onChange} requestUpload={requestUpload} />);
    const file = makeFile('photo.png', 'image/png', 1024);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be uploaded/i);
    expect(onChange).not.toHaveBeenCalled();
  });
});
