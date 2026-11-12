import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_UI_STRINGS, Modal, ModalActions, UiStringsProvider } from './components';

function Dialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Edit lesson" onClose={onClose}>
      <label>
        Title
        <input />
      </label>
      <ModalActions>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </ModalActions>
    </Modal>
  );
}

describe('Modal header ✕ (Decision 460)', () => {
  it('renders a round ✕ in the header, named "Close dialog"', () => {
    render(<Dialog onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit lesson' });
    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect(dialog).toContainElement(close);
    expect(close.closest('.ultm8-modal__head')).not.toBeNull();
    expect(close).toHaveAttribute('type', 'button');
  });

  it('calls onClose, like Escape and Cancel, when nothing was edited', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('after an edit, behaves as Cancel does (closes), while Escape and a click outside still do nothing', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'x');

    fireEvent.keyDown(document, { key: 'Escape' });
    const overlay = document.querySelector('.ultm8-modal-overlay')!;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('takes its name from UiStringsProvider', () => {
    render(
      <UiStringsProvider strings={{ ...DEFAULT_UI_STRINGS, closeDialog: 'Fermer la boîte de dialogue' }}>
        <Dialog onClose={vi.fn()} />
      </UiStringsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Fermer la boîte de dialogue' })).toBeInTheDocument();
  });
});
