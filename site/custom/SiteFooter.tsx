import type { QuartzComponent } from "../quartz/components/types";
import { pathToRoot } from "../quartz/util/path";
export const SiteFooter: QuartzComponent = ({ fileData }) => (
  <footer class="site-footer">
    <p>
      Original text is available under{" "}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
      ; quoted material and third-party media retain their own terms. Built with{" "}
      <a href="https://quartz.jzhao.xyz/">Quartz</a>.
    </p>
    <nav aria-label="Footer">
      <a href={`${pathToRoot(fileData.slug!)}/privacy`}>Privacy policy</a>
      <a href={`${pathToRoot(fileData.slug!)}/license`}>License</a>
      <a href="https://github.com/yuitof/encyclopedic_knowledge_of_english_language">
        Source on GitHub
      </a>
    </nav>
  </footer>
);
