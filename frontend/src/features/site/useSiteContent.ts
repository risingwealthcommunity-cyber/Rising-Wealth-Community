import { useCallback, useEffect, useState } from 'react';
import { EMPTY_CONTENT, siteApi } from './site.api';
import type { SiteContent } from './site.api';

/** Admin-managed home page content. Failing to load it is never fatal: sections fall back to defaults. */
export function useSiteContent() {
  const [content, setContent] = useState<SiteContent>(EMPTY_CONTENT);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      setContent(await siteApi.content());
    } catch {
      /* keep what we have */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { content, loaded, reload, setContent };
}
