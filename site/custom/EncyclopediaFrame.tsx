import type { PageFrame } from "../quartz/components/frames";
import { pathToRoot } from "../quartz/util/path";
import { withArticleBacklinks } from "./article-backlinks";

/** Uses Quartz 5's frame registry; no changes to the renderer are needed. */
export const EncyclopediaFrame: PageFrame = {
  name: "encyclopedia",
  render({
    componentData: data,
    header,
    left,
    right,
    beforeBody,
    pageBody: Content,
    afterBody,
    footer,
  }) {
    const home = pathToRoot(data.fileData.slug!);
    const articleData = withArticleBacklinks(data);
    return (
      <>
        <a class="skip-link" href="#main-content">
          Skip to article
        </a>
        <header class="encyclopedia-header">
          <a
            class="encyclopedia-brand"
            href={home}
            aria-label="English Encyclopedia home"
          >
            <span class="brand-mark" aria-hidden="true">
              E
            </span>
            <span>
              <strong>English Encyclopedia</strong>
              <small>Words, usage, and connections</small>
            </span>
          </a>
          {header.map((Component) => (
            <Component {...data} />
          ))}
          <nav class="header-links" aria-label="Main navigation">
            <a href={home}>Main page</a>
            <a href={`${home}/articles/`}>Browse entries</a>
          </nav>
        </header>
        <div class="reading-row">
          <aside class="left sidebar" aria-label="Article navigation">
            {left.map((Component) => (
              <Component {...data} />
            ))}
          </aside>
          <main id="main-content" class="center" tabIndex={-1}>
            <div class="article-toolbar">
              <span>Article</span>
              <span>Read</span>
            </div>
            <div class="page-header">
              {beforeBody.map((Component) => (
                <Component {...data} />
              ))}
            </div>
            <Content {...articleData} />
            <div class="page-footer">
              {afterBody.map((Component) => (
                <Component {...data} />
              ))}
            </div>
          </main>
          <aside class="right sidebar" aria-label="Related information">
            <h2 class="sidebar-title">Around this article</h2>
            {right.map((Component) => (
              <Component {...data} />
            ))}
          </aside>
        </div>
        <div class="encyclopedia-footer">
          {footer.map((Component) => (
            <Component {...data} />
          ))}
        </div>
      </>
    );
  },
};
