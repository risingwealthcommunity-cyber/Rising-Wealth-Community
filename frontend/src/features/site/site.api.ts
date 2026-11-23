import { api, apiUpload } from '../../shared/api/apiClient';

export interface SiteAsset {
  url: string;
  updatedAt: string;
}
export type SiteAssets = Record<string, SiteAsset>;

export interface Milestone {
  value: string;
  label: string;
}
export interface TeamMember {
  id?: string;
  name: string;
  role: string;
  bio: string;
}
export interface Review {
  id?: string;
  name: string;
  tag: string;
}
export interface Contact {
  phone: string;
  whatsapp: string;
  email: string;
  instagram: string;
  youtube: string;
  facebook: string;
  telegram: string;
  /** Web3Forms access key for the Get in Touch form (public by design). */
  formKey: string;
}

export interface SiteContent {
  assets: SiteAssets;
  milestones: Milestone[] | null;
  team: TeamMember[] | null;
  reviews: Review[] | null;
  contact: Contact | null;
  pageText?: { texts: Record<string, string> } | null;
  loginPopup?: { enabled: boolean; link: string } | null;
}

export type ContentBlock = 'milestones' | 'team' | 'reviews' | 'contact';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const EMPTY_CONTENT: SiteContent = { assets: {}, milestones: null, team: null, reviews: null, contact: null };

export const siteApi = {
  async content(): Promise<SiteContent> {
    const res = await api<SiteContent>('/site/content');
    return res.data ?? EMPTY_CONTENT;
  },
  async save(block: ContentBlock, body: unknown): Promise<SiteContent> {
    const res = await api<SiteContent>(`/site/content/${block}`, { method: 'PUT', body });
    return res.data ?? EMPTY_CONTENT;
  },
  upload: (key: string, file: File) => apiUpload<{ asset: SiteAsset }>(`/site/assets/${key}`, file),
  remove: (key: string) => api(`/site/assets/${key}`, { method: 'DELETE' })
};
