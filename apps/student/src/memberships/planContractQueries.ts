import { useMutation, useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Decision 316 item 6: the plan's contract, read before signing. A parent
 * reads it for their child with `studentId`. */
export function usePlanContract(planId: string | null, studentId?: string) {
  return useQuery({
    queryKey: ['planContract', planId, studentId ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/membership-plans/{id}/contract', {
          params: { path: { id: planId! }, query: studentId ? { studentId } : {} },
        }),
      ),
    enabled: !!planId,
  });
}

/** The drawn signature goes to storage first (as for waivers), then its key
 * is sent with the signature. */
async function uploadDrawnSignature(planId: string, base64Png: string, studentId?: string): Promise<string> {
  const { uploadUrl, objectKey } = await unwrap(
    apiClient.POST('/v1/membership-plans/{id}/contract/signature-upload-url', {
      params: { path: { id: planId } },
      body: studentId ? { studentId } : {},
    }),
  );
  const blob = await (await fetch(base64Png)).blob();
  const putRes = await fetch(uploadUrl, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/png' } });
  if (!putRes.ok) {
    throw new Error(`Signature image upload failed (HTTP ${putRes.status})`);
  }
  return objectKey;
}

/** Signs the contract; the returned id is sent with the purchase. */
export function useSignPlanContract() {
  return useMutation({
    mutationFn: async ({
      planId,
      signerFullName,
      signatureText,
      signatureImage,
      contractVersion,
      studentId,
    }: {
      planId: string;
      signerFullName: string;
      signatureText: string;
      signatureImage: string | null;
      contractVersion: number;
      studentId?: string;
    }) => {
      const signatureImageKey = signatureImage ? await uploadDrawnSignature(planId, signatureImage, studentId) : undefined;
      return unwrap(
        apiClient.POST('/v1/membership-plans/{id}/contract/sign', {
          params: { path: { id: planId } },
          body: { signerFullName, signatureText, signatureImageKey, contractVersion, ...(studentId ? { studentId } : {}) },
        }),
      );
    },
  });
}
