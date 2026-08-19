type PreviewResponse = {
  ok: boolean;
  blob: () => Promise<Blob>;
};

type EvidencePreviewDependencies = {
  fetchPreview: (url: string) => Promise<PreviewResponse>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  isActive: () => boolean;
};

export async function loadEvidencePreview(
  url: string,
  { fetchPreview, createObjectURL, revokeObjectURL, isActive }: EvidencePreviewDependencies,
  onPreview: (url: string) => void,
): Promise<boolean> {
  const response = await fetchPreview(url);
  if (!response.ok) return false;

  const previewUrl = createObjectURL(await response.blob());
  if (!isActive()) {
    revokeObjectURL(previewUrl);
    return false;
  }

  onPreview(previewUrl);
  return true;
}
