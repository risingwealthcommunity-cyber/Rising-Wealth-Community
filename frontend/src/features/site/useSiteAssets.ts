import { useCallback, useEffect, useState } from 'react';
import { siteApi } from './site.api';
import type { SiteAssets } from './site.api';

/** Admin-managed images (About photo, certificate). Failing to load them is never fatal. */
export function useSiteAssets() {
  const [assets, setAssets] = useState<SiteAssets>({});
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setAssets(await siteApi.list());
    } catch {
      /* the page still renders with its built-in fallbacks */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { assets, loaded, reload };
}
