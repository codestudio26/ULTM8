import React from 'react';
import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { LegalFooter } from './LegalFooter';

describe('LegalFooter', () => {
  it('shows the copyright line and the three disabled links (Decision 256)', async () => {
    const { getByText } = await render(<LegalFooter />);
    expect(getByText(`© ${new Date().getFullYear()} ULTM8`)).toBeTruthy();
    expect(getByText('Terms of Service (coming soon)  ·  Privacy Policy (coming soon)  ·  Support (coming soon)')).toBeTruthy();
  });
});
