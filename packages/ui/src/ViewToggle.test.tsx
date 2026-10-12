import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewToggle } from './components';

describe('ViewToggle', () => {
  it('renders both the Rows and Grid options', () => {
    render(<ViewToggle value="rows" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /rows/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grid/i })).toBeInTheDocument();
  });

  it('marks the current value as the active/pressed option', () => {
    render(<ViewToggle value="grid" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /rows/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /grid/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking the inactive option calls onChange with that mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewToggle value="rows" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /grid/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('grid');
  });

  it('clicking the already-active option still calls onChange with that same mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewToggle value="rows" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /rows/i }));

    expect(onChange).toHaveBeenCalledWith('rows');
  });
});
