import React from 'react';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as q from './profileQueries';
import { ProfileScreen } from './ProfileScreen';

jest.mock('./profileQueries', () => ({
  useMyProfile: jest.fn(),
  useUpdateProfile: jest.fn(),
  useUploadMyProfilePhoto: jest.fn(),
  useLanguages: jest.fn(),
  useCurrencies: jest.fn(),
}));
// Google Places street lookup: switched off here (no key), so no search box.
jest.mock('./addressLookupQueries', () => ({
  useAddressLookupStatus: () => ({ data: { enabled: false } }),
  fetchAddressSuggestions: jest.fn(),
  fetchAddressDetails: jest.fn(),
  newSessionToken: () => 'tok',
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

const mocked = <T,>(fn: T) => fn as unknown as jest.Mock;

const idleMutation = () => ({ mutate: jest.fn(), isPending: false, isError: false, error: null });

const PROFILE = {
  id: 'student-1',
  email: 'student@example.test',
  phone: '+15551234567',
  phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
  firstName: 'Jamie',
  surname: 'Lee',
  dateOfBirth: '2010-05-01T00:00:00.000Z',
  profilePhotoUrl: null,
};

/**
 * Task #36 — profile photo self-upload. Mirrors paymentMethods.test.tsx's own
 * house style: mock every query/native module entirely, inline fixtures,
 * render + fireEvent (both awaited), no real react-query/network/Expo runtime.
 */
describe('ProfileScreen — photo self-upload', () => {
  let uploadPhoto: ReturnType<typeof idleMutation>;
  let updateProfile: ReturnType<typeof idleMutation>;

  beforeEach(() => {
    jest.clearAllMocks();
    uploadPhoto = idleMutation();
    updateProfile = idleMutation();
    mocked(q.useMyProfile).mockReturnValue({ data: PROFILE, isLoading: false, isError: false, error: null });
    mocked(q.useUpdateProfile).mockReturnValue(updateProfile);
    mocked(q.useUploadMyProfilePhoto).mockReturnValue(uploadPhoto);
    mocked(q.useLanguages).mockReturnValue({ data: [], isLoading: false });
    mocked(q.useCurrencies).mockReturnValue({ data: [], isLoading: false });
  });

  it('picking a valid photo from the library uploads it', async () => {
    mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
    } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Choose Photo'));

    expect(uploadPhoto.mutate).toHaveBeenCalledWith({ uri: 'file:///tmp/photo.jpg', contentType: 'image/jpeg' });
  });

  it('denied library permission shows an error and never uploads', async () => {
    mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: false } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Choose Photo'));

    expect(getByText(/Photo library access is needed/)).toBeTruthy();
    expect(uploadPhoto.mutate).not.toHaveBeenCalled();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('a file over 5MB is rejected client-side, never uploaded', async () => {
    mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/big.jpg', mimeType: 'image/jpeg', fileSize: 6 * 1024 * 1024 }],
    } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Choose Photo'));

    expect(getByText(/too large/)).toBeTruthy();
    expect(uploadPhoto.mutate).not.toHaveBeenCalled();
  });

  it('a disallowed image type is rejected client-side, never uploaded', async () => {
    mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/photo.heic', mimeType: 'image/heic', fileSize: 1024 }],
    } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Choose Photo'));

    expect(getByText(/PNG, JPEG, or WebP/)).toBeTruthy();
    expect(uploadPhoto.mutate).not.toHaveBeenCalled();
  });

  it('canceling the picker uploads nothing', async () => {
    mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Choose Photo'));

    expect(uploadPhoto.mutate).not.toHaveBeenCalled();
  });

  it('Take Photo goes through the camera permission + launchCameraAsync, not the library', async () => {
    mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as never);
    mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/selfie.png', mimeType: 'image/png', fileSize: 2048 }],
    } as never);

    const { getByText } = await render(<ProfileScreen />);
    await fireEvent.press(getByText('Take Photo'));

    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(uploadPhoto.mutate).toHaveBeenCalledWith({ uri: 'file:///tmp/selfie.png', contentType: 'image/png' });
  });
});
