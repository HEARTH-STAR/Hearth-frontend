import { mergePageSnapshot } from './page-snapshots';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../server/pages';
import type { Space, WorkspaceState } from '../shared/types';
import { api } from './api';
import { SpaceLibrary } from './SpaceLibrary';
import { SpaceSetup } from './SpaceSetup';
import { PageDocument } from './PageDocument';
import { PageOutline } from './PageOutline';
export type SpaceSection = 'pages' | 'setup';
/** A Dot's Space: its Setup page (container, Claude Code, GitHub) or its Pages, and one page. */
export function SpaceWorkspace({
  space,
  section,
  pageId,
  workspace,
  paused,
  onPage,
  onDirty,
  onRefresh,
  onThread,
  onCreateDot,
}: {
  space: Space;
  section: SpaceSection;
  pageId?: string;
  workspace: WorkspaceState;
  paused: boolean;
  onPage: (id?: string) => void;
  onDirty: (value: boolean) => void;
  onRefresh: () => void;
  onThread: (threadId: string) => void;
  onCreateDot: () => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const removed = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [outline, setOutline] = useState(false);
  useEffect(() => {
    if (section === 'setup') return;
    let active = true;
    const load = async () => {
      try {
        const next = await api<Page[]>(`/spaces/${space.id}/pages`);
        if (active) {
          setPages((previous) =>
            mergePageSnapshot(previous, next, removed.current),
          );
          setLoaded(true);
          setError('');
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'Could not load pages.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [space.id, section]);
  const page = pages.find((item) => item.id === pageId);
  const saved = useCallback(
    (next: Page) =>
      setPages((previous) =>
        previous.map((item) =>
          item.id === next.id && item.revision < next.revision ? next : item,
        ),
      ),
    [],
  );
  const deleted = useCallback((id: string) => {
    removed.current.add(id);
    setPages((previous) => {
      const parentId =
        previous.find((item) => item.id === id)?.parentId ?? null;
      return previous
        .filter((item) => item.id !== id)
        .map((item) => (item.parentId === id ? { ...item, parentId } : item));
    });
  }, []);
  const create = async (parentId: string | null) => {
    try {
      const next = await api<Page>(`/spaces/${space.id}/pages`, 'POST', {
        title: 'Untitled page',
        content: '',
        parentId,
      });
      setPages((previous) => [...previous, next]);
      onPage(next.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create page.');
    }
  };
  return (
    <main
      aria-label="Space documents"
      className={`spaces-surface ${pageId ? 'writing' : 'library'}`}
    >
      {error && (
        <div className="document-load-error" role="alert">
          {error}
        </div>
      )}
      {section === 'setup' ? (
        <section className="space-library" aria-label={`${space.name} setup`}>
          <header className="library-heading">
            <div>
              <span className="library-eyebrow">SPACE</span>
              <h1>{space.name}</h1>
              {space.description && <p>{space.description}</p>}
            </div>
          </header>
          <SpaceSetup space={space} onChanged={onRefresh} />
        </section>
      ) : !pageId ? (
        <SpaceLibrary
          space={space}
          pages={pages}
          onPage={onPage}
          onNew={() => void create(null)}
        />
      ) : page ? (
        <div className="space-writing-layout">
          {outline && (
            <PageOutline
              pages={pages}
              selected={page.id}
              onPage={(id) => {
                onPage(id);
                if (window.innerWidth < 760) setOutline(false);
              }}
              onNew={() => void create(null)}
              onClose={() => setOutline(false)}
            />
          )}
          <PageDocument
            key={page.id}
            page={page}
            pages={pages}
            workspace={workspace}
            paused={paused}
            onHome={() => onPage()}
            onOutline={() => setOutline(!outline)}
            onSubpage={() => void create(page.id)}
            onDirty={onDirty}
            onSaved={saved}
            onDeleted={deleted}
            onRefresh={onRefresh}
            onThread={onThread}
            onCreateDot={onCreateDot}
          />
        </div>
      ) : (
        <div className="library-empty">
          <h2>{loaded ? 'Page not found' : 'Loading page…'}</h2>
          {loaded && (
            <button className="document-primary" onClick={() => onPage()}>
              Back to all pages
            </button>
          )}
        </div>
      )}
    </main>
  );
}
