import { api, apiUpload } from '../../shared/api/apiClient';

export type AssetKey = 'about-image' | 'certificate';
export interface SiteAsset {
  url: string;
  updatedAt: string;
}
export type SiteAssets = Partial<Record<AssetKey, SiteAsset>>;

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const siteApi = {
  async list(): Promise<SiteAssets> {
    const res = await api<{ assets: SiteAssets }>('/site/assets');
    return res.data?.assets ?? {};
  },
  upload: (key: AssetKey, file: File) => apiUpload<{ asset: SiteAsset }>(`/site/assets/${key}`, file),
  remove: (key: AssetKey) => api(`/site/assets/${key}`, { method: 'DELETE' })
};
